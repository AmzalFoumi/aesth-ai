import { Output } from 'ai'
import { z } from 'zod'
import type { ChatOutput, OutputShape } from '../types'
import { SHAPE_SCHEMAS } from './shapes'
import { resolveShapes } from './mode'

/**
 * Build the `output` spec passed to generateText — the structural twin of buildTools.
 * The set of allowed shapes IS the shape of the answer the model can return:
 *   ['plain']                 → just the plain schema
 *   ['plain','timeline',...]  → a discriminated union the model self-selects from
 *
 * The orchestrator doesn't branch on shapes — it just hands generateText whatever this
 * returns. Accepts either an already-resolved shape list or a raw override (which it
 * resolves), so callers can pass `input.shapes` straight through.
 */
/**
 * The Zod schema for the allowed answer shapes — a single schema when one shape is
 * allowed, or a discriminated union when several are. Shared source of truth for both
 * the generateText `output` spec (below) and text→shape recovery (recoverShape.ts).
 */
export const buildShapeSchema = (
  shapesOrOverride?: OutputShape[] | unknown,
): z.ZodType<ChatOutput> => {
  const shapes: OutputShape[] = Array.isArray(shapesOrOverride)
    ? (shapesOrOverride as OutputShape[])
    : resolveShapes(shapesOrOverride)

  const branches = shapes.map((s) => SHAPE_SCHEMAS[s])

  // A single allowed shape needs no union (and z.discriminatedUnion wants 2+ options).
  const schema =
    branches.length === 1
      ? branches[0]
      : z.discriminatedUnion(
          'kind',
          branches as [(typeof branches)[number], ...(typeof branches)[number][]],
        )

  return schema as z.ZodType<ChatOutput>
}

export const buildOutput = (shapesOrOverride?: OutputShape[] | unknown) =>
  Output.object({ schema: buildShapeSchema(shapesOrOverride) })
