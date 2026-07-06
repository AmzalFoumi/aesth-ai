import { generateText, stepCountIs, type ModelMessage } from 'ai'
import type { ChatDataAdapter } from './data/ChatDataAdapter'
import type { ChatOutput, JsonValue, MessageRecord, OutputShape, RetrievalMode } from './types'
import { resolveModel } from './providers/resolveModel'
import { buildTools } from './tools'
import { resolveMode } from './retrieval/mode'
import { resolveShapes } from './output/mode'
import { buildOutput } from './output/buildOutput'
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
  /** Optional per-request override of the allowed answer shapes. Falls back to OUTPUT_SHAPES env. */
  shapes?: string
}

export interface RunChatResult {
  text: string
  sessionKey: string
  blocked: boolean
  /** The retrieval arm that actually ran (after resolving override/env/default). */
  mode: RetrievalMode
  /** The full typed answer the model self-selected (discriminated on `kind`). */
  output: ChatOutput
  /** Convenience: `output.kind`, the chosen answer shape. */
  kind: OutputShape
}

/** Wrap a plain-text reply as the fallback ChatOutput so callers always get a typed object. */
const plainOutput = (spokenAnswer: string): PlainResult => ({
  output: { kind: 'plain', spokenAnswer },
  kind: 'plain',
})

interface PlainResult {
  output: ChatOutput
  kind: OutputShape
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
  const shapes = resolveShapes(input.shapes)
  const session = await adapter.getOrCreateSession(input.sessionKey, input.templateKey)

  if (session.status === 'blocked') {
    const msg = 'This conversation has been blocked.'
    return { text: msg, sessionKey: session.sessionKey, blocked: true, mode, ...plainOutput(msg) }
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
    const msg = inputGate.reason ?? 'Your message was blocked.'
    return { text: msg, sessionKey: session.sessionKey, blocked: true, mode, ...plainOutput(msg) }
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
    output: buildOutput(shapes), // typed, shape-tagged answer alongside the tool loop
    stopWhen: stepCountIs(4), // call tool -> read rows -> compose typed answer
  })

  const toolCalls = result.steps.flatMap((s) => s.toolCalls ?? [])
  const toolResults = result.steps.flatMap((s) => s.toolResults ?? [])

  // The model self-selected a shape; every shape carries spokenAnswer. If the model
  // returned nothing usable, fall back to a plain answer wrapping result.text.
  const modelOutput = (result.output ?? null) as ChatOutput | null
  const spoken = modelOutput?.spokenAnswer?.trim() || result.text

  // Guardrails run on the plain-text answer, same as before — shape-agnostic.
  const outGate = runOutputGuardrails({ text: spoken })
  const finalText = outGate.sanitized?.trim() || FALLBACK

  // Keep output and spokenAnswer in sync after guardrails; fall back to plain if needed.
  const finalOutput: ChatOutput =
    modelOutput && (outGate.allowed !== false)
      ? { ...modelOutput, spokenAnswer: finalText }
      : { kind: 'plain', spokenAnswer: finalText }

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
    outputShape: finalOutput.kind,
    structuredOutput: asJson(finalOutput),
  })

  return {
    text: finalText,
    sessionKey: session.sessionKey,
    blocked: false,
    mode,
    output: finalOutput,
    kind: finalOutput.kind,
  }
}
