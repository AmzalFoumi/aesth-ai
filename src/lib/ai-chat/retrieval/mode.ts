import type { RetrievalMode } from '../types'

export type { RetrievalMode }

const MODES: readonly RetrievalMode[] = ['db', 'rag', 'both']

const isMode = (v: unknown): v is RetrievalMode =>
  typeof v === 'string' && (MODES as readonly string[]).includes(v)

/**
 * The A/B seam. Decides which retrieval arm a request runs in:
 *   db   → only the exact DB-filter tool (queryProducts)
 *   rag  → only the semantic tool (searchKnowledgeBase)
 *   both → the model gets both tools and picks
 *
 * Precedence: explicit per-request override > RETRIEVAL_MODE env > 'db' default.
 * Unknown values fall through to the default so a bad env/body can't crash a request.
 */
export const resolveMode = (override?: unknown): RetrievalMode => {
  if (isMode(override)) return override
  if (isMode(process.env.RETRIEVAL_MODE)) return process.env.RETRIEVAL_MODE
  return 'db'
}
