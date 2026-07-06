import type { OutputShape } from '../types'
import { SHAPE_SCHEMAS } from './shapes'

export type { OutputShape }

const isShape = (v: unknown): v is OutputShape =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_SCHEMAS, v)

/** Parse a comma list ("plain,timeline") into known shapes, dropping anything unknown. */
const parseList = (raw: unknown): OutputShape[] =>
  typeof raw === 'string' ? raw.split(',').map((s) => s.trim()).filter(isShape) : []

/**
 * The output-shape seam — the structural twin of resolveMode. Decides which answer
 * shapes the model is allowed to choose from for a request. The union passed to the
 * model is built from exactly this set (see buildOutput).
 *
 * Precedence: explicit per-request override > OUTPUT_SHAPES env > 'plain' only.
 * `plain` is ALWAYS forced in as the fallback, and unknown names are dropped, so a
 * bad env/body can never leave the model with no valid shape or crash a request.
 *
 * A prod copy can ship OUTPUT_SHAPES=plain and behave exactly like plain-text mode,
 * with zero code change.
 */
export const resolveShapes = (override?: unknown): OutputShape[] => {
  const chosen = parseList(override)
  const fromEnv = chosen.length > 0 ? chosen : parseList(process.env.OUTPUT_SHAPES)
  // Always include 'plain', dedupe, keep a stable order.
  const set = new Set<OutputShape>(['plain', ...fromEnv])
  return [...set]
}
