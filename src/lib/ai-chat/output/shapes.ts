import { z } from 'zod'
import type { OutputShape } from '../types'

/**
 * Zod schema per answer shape. The model self-selects ONE of these (discriminated
 * on `kind`) when it composes the final answer. Every schema carries `spokenAnswer`
 * — the plain-text reply used for guardrails, persistence, and as the text-only
 * fallback — so no downstream code depends on which shape was chosen.
 *
 * `.describe(...)` text is sent to the model as field docs, so keep it instructive:
 * it's how the model knows when to reach for each shape and what to put where.
 * See STRUCTURED-OUTPUT.md for the design.
 */

const spokenAnswer = z
  .string()
  .describe(
    'The full answer in plain, friendly prose. Always fill this in — it is what non-structured clients show and what safety checks run on.',
  )

/** Plain prose — always available; the fallback when no richer shape fits. */
export const plainSchema = z.object({
  kind: z.literal('plain'),
  spokenAnswer,
})

/** Ordered process/routine — for "how do I…", "what's the routine for…" questions. */
export const timelineSchema = z.object({
  kind: z.literal('timeline'),
  spokenAnswer,
  title: z.string().describe('A short title for the process, e.g. "Routine for dry skin".'),
  steps: z
    .array(
      z.object({
        order: z.number().int().describe('1-based position of this step.'),
        title: z.string().describe('Short label for the step.'),
        detail: z.string().describe('What to do in this step and why.'),
        productRefs: z
          .array(z.string())
          .optional()
          .describe('Names of catalog products this step uses, if any.'),
      }),
    )
    .describe('The ordered steps, first to last.'),
})

/** Recommended products — for shopping / "recommend me…" questions. */
export const productListSchema = z.object({
  kind: z.literal('productList'),
  spokenAnswer,
  intro: z.string().optional().describe('Optional one-line framing before the list.'),
  products: z
    .array(
      z.object({
        name: z.string(),
        brand: z.string().optional(),
        priceRange: z.string().optional(),
        rating: z.number().optional(),
        url: z.string().optional(),
        why: z.string().optional().describe('One line on why this product fits the question.'),
      }),
    )
    .describe('The recommended products, best match first. Only real catalog items.'),
})

/** Side-by-side comparison — for "X vs Y" questions. */
export const comparisonSchema = z.object({
  kind: z.literal('comparison'),
  spokenAnswer,
  items: z.array(z.string()).describe('The things being compared (the columns), in order.'),
  rows: z
    .array(
      z.object({
        feature: z.string().describe('The attribute being compared (the row label).'),
        values: z
          .array(z.string())
          .describe('One value per item, in the SAME order as `items`.'),
      }),
    )
    .describe('One row per compared feature.'),
})

/** Registry: OutputShape name -> its Zod schema. Drives the allowlist + union builder. */
export const SHAPE_SCHEMAS = {
  plain: plainSchema,
  timeline: timelineSchema,
  productList: productListSchema,
  comparison: comparisonSchema,
} as const satisfies Record<OutputShape, z.ZodType>

/** The full set of shape names, in a stable order. */
export const ALL_SHAPES = Object.keys(SHAPE_SCHEMAS) as OutputShape[]
