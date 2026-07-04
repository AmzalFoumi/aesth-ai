// Shared, framework-agnostic types for the ai-chat core.
// Nothing here imports payload or a provider SDK.

export type ChatRole = 'user' | 'assistant' | 'tool' | 'system'

/**
 * Result of a guardrail rule or pipeline.
 * - allowed=false  -> stop; `reason` explains why (may be shown to the user).
 * - sanitized      -> a cleaned version of the text (e.g. PII redacted, truncated).
 */
export interface GuardrailResult {
  allowed: boolean
  reason?: string
  sanitized?: string
}

/** Arguments the LLM supplies when it calls the queryProducts tool. */
export interface ProductQueryArgs {
  search?: string
  brandName?: string
  category?: string
  minRating?: number
  limit?: number
}

/** Lean product shape returned to the model (only what it needs — keeps tokens down). */
export interface ProductSummary {
  productName: string
  brandName?: string
  defaultCategory?: string
  priceRange?: string
  averageRating?: number
  totalReviews?: number
  url?: string
}

export interface SessionRecord {
  id: string
  sessionKey: string
  promptTemplateKey?: string
  status: 'active' | 'archived' | 'blocked'
}

export interface MessageRecord {
  id: string
  role: ChatRole
  content: string
}

/** JSON value shape accepted by Payload `json` fields. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | unknown[]
  | { [k: string]: unknown }

export interface NewMessage {
  session: string
  role: ChatRole
  content: string
  toolCalls?: JsonValue
  toolResults?: JsonValue
  guardrailFlags?: JsonValue
  tokenUsage?: JsonValue
}
