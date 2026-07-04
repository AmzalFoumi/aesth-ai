import { tool } from 'ai'
import { z } from 'zod'
import type { ChatDataAdapter } from '../data/ChatDataAdapter'

/**
 * The "chat with your DB, no RAG" mechanism. We describe this function to the LLM;
 * the model decides WHEN to call it and WHAT filters to use based on the user's
 * question. Our adapter runs the real query and returns rows, which the model then
 * phrases into an answer. Grounding = these results.
 *
 * Note (AI SDK v7): the schema key is `inputSchema` (was `parameters` in v4).
 */
export const buildQueryProducts = (adapter: ChatDataAdapter) =>
  tool({
    description:
      'Search the beauty-product catalog by free text, brand, or category, optionally filtered by a minimum average rating. Returns real products from the database. Call this before answering any question about specific products.',
    inputSchema: z.object({
      search: z
        .string()
        .optional()
        .describe('Free-text search over product name and brand.'),
      brandName: z.string().optional().describe('Filter to a specific brand.'),
      category: z.string().optional().describe('Filter by product category.'),
      minRating: z
        .number()
        .optional()
        .describe('Only include products with at least this average rating (0-5).'),
      limit: z
        .number()
        .max(10)
        .default(5)
        .describe('Max number of products to return (up to 10).'),
    }),
    execute: async (args) => adapter.queryProducts(args),
  })
