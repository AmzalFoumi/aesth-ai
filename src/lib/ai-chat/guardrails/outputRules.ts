import type { GuardrailResult } from '../types'

// Output-side transforms. These generally don't block — they clean the text.

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
// Loose phone matcher (7+ digits allowing spaces, dashes, parens, leading +).
const PHONE = /(?:\+?\d[\d\s().-]{6,}\d)/g
const CREDIT_CARD = /\b(?:\d[ -]*?){13,16}\b/g

/**
 * Redact PII from a string. Used on OUTPUT before returning, and reusable on
 * INPUT before logging/persisting. Order matters: cards before generic phone.
 */
export const redactPii = (text: string): string =>
  text
    .replace(EMAIL, '[redacted-email]')
    .replace(CREDIT_CARD, '[redacted-number]')
    .replace(PHONE, '[redacted-phone]')

export const redactPiiRule = (text: string): GuardrailResult => {
  const sanitized = redactPii(text)
  return { allowed: true, sanitized }
}

/** Truncate overly long answers so the widget stays sane. Does not block. */
export const checkOutputLength = (
  text: string,
  maxChars = 4000,
): GuardrailResult => {
  if (text.length <= maxChars) return { allowed: true, sanitized: text }
  return { allowed: true, sanitized: text.slice(0, maxChars).trimEnd() + '…' }
}
