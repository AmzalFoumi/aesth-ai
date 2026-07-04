import type {
  MessageRecord,
  NewMessage,
  ProductQueryArgs,
  ProductSummary,
  SessionRecord,
} from '../types'

/**
 * The decoupling seam. The ai-chat core depends ONLY on this interface, never on
 * `payload` or a database driver. A different host project (or a future extracted
 * npm package) supplies its own implementation against its own storage, and the
 * orchestrator/tools/guardrails keep working unchanged.
 *
 * This is what makes the chatbot DB-agnostic and platform-agnostic: the Mongo (or
 * any future DB) question lives entirely inside the implementation of this interface.
 */
export interface ChatDataAdapter {
  getOrCreateSession(sessionKey: string, templateKey: string): Promise<SessionRecord>
  getRecentMessages(sessionId: string, limit: number): Promise<MessageRecord[]>
  saveMessage(msg: NewMessage): Promise<void>
  getActivePromptTemplate(
    key: string,
  ): Promise<{ systemPrompt: string; version: number } | null>
  queryProducts(args: ProductQueryArgs): Promise<ProductSummary[]>
}
