import { google } from '@ai-sdk/google'
import type { EmbeddingModel } from 'ai'

/**
 * The embedding-model-agnostic seam — the twin of `resolveModel()` for RAG.
 *
 * Business/ingestion code (the backfill script, the searchKnowledgeBase tool) imports ONLY this
 * function and never an embedding SDK directly, so switching embedding providers is a one-line env
 * change and never touches the vector store or the tools:
 *
 *   EMBEDDING_PROVIDER=google   (default) -> Gemini embeddings, free tier
 *   EMBEDDING_MODEL             (optional) -> override the model id
 *
 * Model note: default is `gemini-embedding-001`, NOT `gemini-embedding-2`. Only `-001` returns an
 * individual vector per string in a list (real batching for `embedMany`); `-2` aggregates a list
 * into ONE vector unless each input is wrapped in a Content object. See the plan (§ embedding model
 * choice) for the full reasoning.
 *
 * Output dimensionality (EMBEDDING_DIMS, default 768) and taskType are passed by callers via
 * `providerOptions.google` on the embed/embedMany call — they are per-call concerns, not baked here,
 * so the same resolved model serves both index-time (RETRIEVAL_DOCUMENT) and query-time
 * (RETRIEVAL_QUERY) embedding.
 */
export const resolveEmbeddingModel = (): EmbeddingModel => {
  const provider = process.env.EMBEDDING_PROVIDER ?? 'google'
  const modelId = process.env.EMBEDDING_MODEL

  switch (provider) {
    case 'google':
      return google.textEmbeddingModel(modelId ?? 'gemini-embedding-001')
    // Other providers slot in here exactly like resolveModel(), e.g.:
    //   case 'openai': return openai.textEmbeddingModel(modelId ?? 'text-embedding-3-small')
    default:
      throw new Error(
        `Unknown EMBEDDING_PROVIDER "${provider}". Use one of: google.`,
      )
  }
}

/** Target embedding dimensionality, env-driven so it stays in lockstep with the Atlas index. */
export const embeddingDims = (): number => Number(process.env.EMBEDDING_DIMS ?? 768)

/** The model id we tag stored vectors with, so a model change can trigger a re-embed. */
export const embeddingModelId = (): string =>
  process.env.EMBEDDING_MODEL ?? 'gemini-embedding-001'
