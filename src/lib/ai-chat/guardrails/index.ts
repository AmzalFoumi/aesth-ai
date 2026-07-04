import type { GuardrailResult } from '../types'
import { checkOffTopic, checkPromptInjection, createRateLimitRule } from './inputRules'
import { checkOutputLength, redactPii } from './outputRules'

export * from './inputRules'
export * from './outputRules'

// One shared rate limiter instance for the app runtime (in-memory; see LIMITATION
// note in inputRules.ts). Tests build their own via createRateLimitRule().
const rateLimit = createRateLimitRule()

export interface InputGuardrailContext {
  message: string
  sessionKey: string
}

export interface OutputGuardrailContext {
  text: string
}

/**
 * Run input rules in order; the FIRST blocking rule short-circuits. Returns
 * allowed=true only if every rule passes.
 */
export const runInputGuardrails = (ctx: InputGuardrailContext): GuardrailResult => {
  const rules: GuardrailResult[] = [
    rateLimit(ctx.sessionKey),
    checkPromptInjection(ctx.message),
    checkOffTopic(ctx.message),
  ]
  const blocked = rules.find((r) => !r.allowed)
  return blocked ?? { allowed: true }
}

/**
 * Run output transforms in sequence, threading the sanitized text through each.
 * Never blocks in the demo — it cleans (PII redaction, then length cap).
 */
export const runOutputGuardrails = (ctx: OutputGuardrailContext): GuardrailResult => {
  let text = redactPii(ctx.text)
  text = checkOutputLength(text).sanitized ?? text
  return { allowed: true, sanitized: text }
}
