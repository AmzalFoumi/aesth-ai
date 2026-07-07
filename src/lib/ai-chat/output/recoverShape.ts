import type { ChatOutput, OutputShape } from '../types'
import { buildShapeSchema } from './buildOutput'
import { ALL_SHAPES } from './shapes'

/** A field unique to each non-plain shape, used to guess `kind` when it's missing entirely. */
const SHAPE_SIGNATURE_KEY: Partial<Record<OutputShape, string>> = {
  timeline: 'steps',
  productList: 'products',
  comparison: 'rows',
}

/**
 * Models degrade the union into text in several different malformed ways instead of
 * the flat, `kind`-discriminated object the schema wants:
 *   - wrapped:      { spokenAnswer, productList: { products: [...] } }
 *   - wrapped-empty: { spokenAnswer, plain: {} }
 *   - flat, no kind: { spokenAnswer, products: [...] }
 * Normalize any of these into a `kind`-tagged flat object so the real validation
 * below still has a chance to succeed.
 */
const flattenWrapper = (parsed: unknown): unknown => {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return parsed
  const obj = parsed as Record<string, unknown>

  const wrapperKey = ALL_SHAPES.find(
    (shape) => typeof obj[shape] === 'object' && obj[shape] !== null && !Array.isArray(obj[shape]),
  )
  if (wrapperKey) {
    const { [wrapperKey]: inner, ...rest } = obj
    return { ...rest, ...(inner as Record<string, unknown>), kind: wrapperKey }
  }

  const signatureShape = (Object.entries(SHAPE_SIGNATURE_KEY) as [OutputShape, string][]).find(
    ([, key]) => Array.isArray(obj[key]),
  )
  if (signatureShape) {
    return { ...obj, kind: signatureShape[0] }
  }

  return { ...obj, kind: 'plain' }
}

/**
 * Recover a structured answer shape that a lighter model serialized into plain text
 * instead of routing through the AI SDK object channel. Returns the typed ChatOutput
 * when `text` parses and validates against the allowed shape union, else null.
 *
 * Kept tolerant of a wrapping ```json code fence, which lighter models sometimes add.
 */
export const recoverShape = (
  text: string,
  shapes: OutputShape[],
): ChatOutput | null => {
  let candidate = text.trim()
  if (!candidate) return null

  // Strip a leading/trailing ```json ... ``` fence if present.
  if (candidate.startsWith('```')) {
    candidate = candidate
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()
  }

  // Only attempt a parse when it actually looks like a JSON object.
  if (!candidate.startsWith('{')) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch {
    return null
  }

  const schema = buildShapeSchema(shapes)
  const direct = schema.safeParse(parsed)
  if (direct.success) return direct.data

  const flattened = schema.safeParse(flattenWrapper(parsed))
  return flattened.success ? flattened.data : null
}
