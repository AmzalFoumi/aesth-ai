import { embed, tool } from 'ai'
import { z } from 'zod'
import type { ChatDataAdapter } from '../data/ChatDataAdapter'
import type { ScoredChunk, SourceType } from '../types'
import { resolveEmbeddingModel, embeddingDims } from '../providers/resolveEmbeddingModel'

const SOURCE_TYPES = [
  'product',
  'treatment',
  'post',
  'testimonial',
  'concern',
  'category',
  'author',
  'page',
] as const

/**
 * The RAG mechanism — the semantic twin of queryProducts. Instead of exact filters,
 * it turns the user's phrase into a vector (same Gemini model as the backfill) and
 * asks the vector store for the nearest chunks BY MEANING. Grounding = those chunks.
 *
 * Note the ONE embedding call per invocation (the user's query) — cheap, unlike the
 * offline backfill. Uses taskType RETRIEVAL_QUERY (docs were embedded as RETRIEVAL_DOCUMENT).
 */
export const buildSearchKnowledgeBase = (adapter: ChatDataAdapter) =>
  tool({
    description:
      'Semantically search the product knowledge base for items matching the MEANING of a description (e.g. "something gentle for sensitive skin", "a long-lasting matte finish"). Use this for fuzzy, descriptive, or need-based questions where exact filters would miss. Returns the closest matching products with a relevance score.',
    inputSchema: z.object({
      query: z
        .string()
        .describe('The natural-language description to find semantically similar items for.'),
      sourceType: z
        .enum(SOURCE_TYPES)
        .optional()
        .describe('Optionally restrict the search to one kind of source (default: products).'),
      limit: z
        .number()
        .max(10)
        .default(5)
        .describe('Max number of matches to return (up to 10).'),
    }),
    execute: async ({ query, sourceType, limit }) => {
      const { embedding } = await embed({
        model: resolveEmbeddingModel(),
        value: query,
        providerOptions: {
          google: { outputDimensionality: embeddingDims(), taskType: 'RETRIEVAL_QUERY' },
        },
      })

      const filter = sourceType
        ? { sourceType: sourceType as SourceType }
        : { sourceType: 'product' as SourceType }

      const rows = await adapter.similaritySearch(embedding, Math.min(limit, 10), filter)

      // Lean shape for the model: the text we embedded + facets + how close the match is.
      return rows.map((r: ScoredChunk) => ({
        sourceId: r.sourceId,
        sourceType: r.sourceType,
        text: r.text,
        score: Number(r.score.toFixed(4)),
        ...r.metadata,
      }))
    },
  })
