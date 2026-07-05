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
  /** Which retrieval arm produced this turn (db|rag|both) — for A/B auditability. */
  retrievalMode?: RetrievalMode
}

// ---------------------------------------------------------------------------
// RAG / vector-store types (Phase 2). Still framework-agnostic — no payload,
// no provider SDK. These describe the shape of what we store and retrieve.
// ---------------------------------------------------------------------------

/**
 * Kind of source document a vector came from. Products now; the CMS prod DB will
 * add treatments/posts/pages later with no schema change (matches Embeddings.sourceType).
 */
export type SourceType =
  | 'product'
  | 'treatment'
  | 'post'
  | 'testimonial'
  | 'concern'
  | 'category'
  | 'author'
  | 'page'

/** One embedded chunk on its way INTO the vector store (write side). */
export interface EmbeddingItem {
  sourceType: SourceType
  sourceId: string
  chunkIndex: number
  text: string
  vector: number[]
  metadata?: Record<string, unknown>
  model: string
  dims: number
}

/** A chunk returned FROM a similarity search (read side) — EmbeddingItem + relevance score. */
export interface ScoredChunk {
  sourceType: SourceType
  sourceId: string
  chunkIndex: number
  text: string
  metadata?: Record<string, unknown>
  score: number
}

/** Optional narrowing applied to a similarity search (e.g. only products). */
export interface SimilarityFilter {
  sourceType?: SourceType
}

/** Which retrieval path(s) the chatbot exposes for a given request (A/B seam). */
export type RetrievalMode = 'db' | 'rag' | 'both'
