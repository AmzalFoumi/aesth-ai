import { generateText, stepCountIs, type ModelMessage } from 'ai'
import type { ChatDataAdapter } from './data/ChatDataAdapter'
import type { JsonValue, MessageRecord, RetrievalMode } from './types'
import { resolveModel } from './providers/resolveModel'
import { buildTools } from './tools'
import { resolveMode } from './retrieval/mode'
import { renderTemplate } from './prompts/render'
import { runInputGuardrails, runOutputGuardrails } from './guardrails'

const FALLBACK =
  "Sorry, I couldn't produce a good answer just now. Please try rephrasing your question about our products."

export interface RunChatInput {
  sessionKey: string
  message: string
  templateKey: string
  /** Optional per-request A/B override: db | rag | both. Falls back to RETRIEVAL_MODE env. */
  mode?: string
}

export interface RunChatResult {
  text: string
  sessionKey: string
  blocked: boolean
  /** The retrieval arm that actually ran (after resolving override/env/default). */
  mode: RetrievalMode
}

const toModelMessages = (history: MessageRecord[]): ModelMessage[] =>
  history.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }))

// Strip anything non-serializable before storing in a Payload json field.
const asJson = (value: unknown): JsonValue =>
  JSON.parse(JSON.stringify(value ?? null))

/**
 * The single entry point. Adapter is dependency-injected so this function never
 * imports `payload` — keeping it DB/platform-agnostic.
 *
 * Flow: load session -> input guardrails -> load prompt + history -> LLM (+tools)
 *       -> output guardrails -> persist user + assistant turns -> return.
 */
export const runChat = async (
  input: RunChatInput,
  adapter: ChatDataAdapter,
): Promise<RunChatResult> => {
  const mode = resolveMode(input.mode)
  const session = await adapter.getOrCreateSession(input.sessionKey, input.templateKey)

  if (session.status === 'blocked') {
    return { text: 'This conversation has been blocked.', sessionKey: session.sessionKey, blocked: true, mode }
  }

  const inputGate = runInputGuardrails({ message: input.message, sessionKey: session.sessionKey })
  if (!inputGate.allowed) {
    await adapter.saveMessage({
      session: session.id,
      role: 'user',
      content: input.message,
      guardrailFlags: { stage: 'input', allowed: false, reason: inputGate.reason },
      retrievalMode: mode,
    })
    return { text: inputGate.reason ?? 'Your message was blocked.', sessionKey: session.sessionKey, blocked: true, mode }
  }

  const [template, history] = await Promise.all([
    adapter.getActivePromptTemplate(input.templateKey),
    adapter.getRecentMessages(session.id, 10),
  ])

  const system = renderTemplate(template?.systemPrompt ?? '', {
    now: new Date().toISOString(),
  })

  const result = await generateText({
    model: resolveModel(),
    system,
    messages: [...toModelMessages(history), { role: 'user', content: input.message }],
    tools: buildTools(adapter, mode),
    stopWhen: stepCountIs(3), // let the model: call tool -> read rows -> answer
  })

  const toolCalls = result.steps.flatMap((s) => s.toolCalls ?? [])
  const toolResults = result.steps.flatMap((s) => s.toolResults ?? [])

  const outGate = runOutputGuardrails({ text: result.text })
  const finalText = outGate.sanitized?.trim() || FALLBACK

  await adapter.saveMessage({
    session: session.id,
    role: 'user',
    content: input.message,
    guardrailFlags: { stage: 'input', allowed: true },
    retrievalMode: mode,
  })
  await adapter.saveMessage({
    session: session.id,
    role: 'assistant',
    content: finalText,
    toolCalls: asJson(toolCalls),
    toolResults: asJson(toolResults),
    tokenUsage: asJson(result.usage),
    retrievalMode: mode,
  })

  return { text: finalText, sessionKey: session.sessionKey, blocked: false, mode }
}
