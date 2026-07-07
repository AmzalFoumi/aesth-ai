import type { ChatOutput, OutputShape } from '../types'
import { buildShapeSchema } from './buildOutput'

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

  const result = buildShapeSchema(shapes).safeParse(parsed)
  return result.success ? result.data : null
}
