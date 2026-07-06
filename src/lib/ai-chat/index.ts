// Public surface of the ai-chat core — the boundary a future npm package exposes.
// Host apps import from here and supply a ChatDataAdapter implementation.

export { runChat } from './orchestrator'
export type { RunChatInput, RunChatResult } from './orchestrator'
export type { ChatDataAdapter } from './data/ChatDataAdapter'
export { createPayloadChatAdapter } from './data/payloadChatAdapter'
export { resolveModel } from './providers/resolveModel'
export {
  resolveEmbeddingModel,
  embeddingDims,
  embeddingModelId,
} from './providers/resolveEmbeddingModel'
export { buildTools } from './tools'
export { resolveMode } from './retrieval/mode'
export { resolveShapes } from './output/mode'
export { buildOutput } from './output/buildOutput'
export { SHAPE_SCHEMAS, ALL_SHAPES } from './output/shapes'
export type { VectorStore } from './vector/VectorStore'
export { chunkText } from './vector/chunkText'
export * from './types'
