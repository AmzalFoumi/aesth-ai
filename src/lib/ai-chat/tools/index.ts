import type { ToolSet } from 'ai'
import type { ChatDataAdapter } from '../data/ChatDataAdapter'
import type { RetrievalMode } from '../types'
import { buildQueryProducts } from './queryProducts'
import { buildSearchKnowledgeBase } from './searchKnowledgeBase'

/**
 * The tool registry passed to the LLM — the A/B switch in physical form.
 * The set of tools the model can see IS the retrieval arm:
 *   db   → only queryProducts (exact DB filters)
 *   rag  → only searchKnowledgeBase (semantic vector search)
 *   both → both tools; the model chooses per question
 *
 * The orchestrator doesn't branch on mode — it just registers whatever this returns.
 */
export const buildTools = (adapter: ChatDataAdapter, mode: RetrievalMode = 'db'): ToolSet => {
  const queryProducts = buildQueryProducts(adapter)
  const searchKnowledgeBase = buildSearchKnowledgeBase(adapter)

  switch (mode) {
    case 'rag':
      return { searchKnowledgeBase }
    case 'both':
      return { queryProducts, searchKnowledgeBase }
    case 'db':
    default:
      return { queryProducts }
  }
}
