import type { ChatDataAdapter } from '../data/ChatDataAdapter'
import { buildQueryProducts } from './queryProducts'

/**
 * The tool registry passed to the LLM. Future tools (e.g. a RAG
 * `searchKnowledgeBase`) are added here — the orchestrator does not change.
 */
export const buildTools = (adapter: ChatDataAdapter) => ({
  queryProducts: buildQueryProducts(adapter),
})
