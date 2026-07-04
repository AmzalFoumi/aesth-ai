import type { GuardrailResult } from '../types'

// Each rule is a small, independently testable function. Compose them in index.ts.
// Scope here is demo-appropriate — heuristics, not bulletproof security. Limits
// are called out in comments so we replace them deliberately for production.

const ALLOWED: GuardrailResult = { allowed: true }

/**
 * Reject obvious prompt-injection attempts (heuristic — NOT a complete defense;
 * the real protection is that the model only answers from tool data).
 */
export const checkPromptInjection = (message: string): GuardrailResult => {
  const patterns = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts?|messages?)/i,
    /disregard\s+(the\s+)?(system|previous|above)/i,
    /you\s+are\s+now\s+/i,
    /reveal\s+(your\s+)?(system\s+)?prompt/i,
    /\bpretend\s+to\s+be\b/i,
  ]
  if (patterns.some((p) => p.test(message))) {
    return { allowed: false, reason: 'Message looks like a prompt-injection attempt.' }
  }
  return ALLOWED
}

/**
 * Keep the bot on-topic. Demo heuristic: block messages that clearly ask for
 * unrelated help (code, current events, finance, etc.). Everything else passes,
 * since the system prompt already steers back toward beauty products.
 */
export const checkOffTopic = (message: string): GuardrailResult => {
  const offTopic = [
    /\b(python|javascript|java|c\+\+|sql|code|program(ming)?|debug)\b/i,
    /\b(stock|bitcoin|crypto|forex|invest(ment)?)\b/i,
    /\b(weather|forecast|election|president|politic(s|al))\b/i,
    /\b(homework|essay|math\s+problem)\b/i,
  ]
  if (offTopic.some((p) => p.test(message))) {
    return {
      allowed: false,
      reason: 'This assistant only helps with beauty products.',
    }
  }
  return ALLOWED
}

/**
 * Simple per-key sliding-window rate limiter.
 *
 * LIMITATION: in-memory only — does NOT survive restarts or span multiple server
 * instances. Fine for the demo; swap for Redis or a DB-backed counter in prod.
 */
export const createRateLimitRule = (opts?: { max?: number; windowMs?: number }) => {
  const max = opts?.max ?? 20
  const windowMs = opts?.windowMs ?? 60_000
  const hits = new Map<string, number[]>()

  const rule = (key: string, now: number = Date.now()): GuardrailResult => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
    if (recent.length >= max) {
      return { allowed: false, reason: 'Too many messages. Please slow down.' }
    }
    recent.push(now)
    hits.set(key, recent)
    return ALLOWED
  }

  // Exposed for tests / manual clearing.
  rule.reset = () => hits.clear()
  return rule
}
