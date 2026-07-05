import type { EmbeddingItem, ScoredChunk, SimilarityFilter } from '../types'

/**
 * The vector-store seam. Like ChatDataAdapter, this keeps the ai-chat core
 * ignorant of WHERE vectors live. Today it's MongoDB Atlas $vectorSearch (via
 * the payload adapter); swapping to Pinecone/Qdrant/pgvector later means writing
 * one new implementation of this interface — no tool or orchestrator change.
 *
 * The payload adapter implements these two methods directly (see ChatDataAdapter),
 * so a host that already has a ChatDataAdapter gets the VectorStore for free. This
 * interface is the explicit contract that documents the vector half of that adapter.
 */
export interface VectorStore {
  /**
   * Idempotent write. Upserts by (sourceType, sourceId, chunkIndex): existing
   * rows for that key are replaced, so re-running the backfill refreshes vectors
   * without creating duplicates.
   */
  upsertEmbeddings(items: EmbeddingItem[]): Promise<void>

  /**
   * Nearest-neighbour search. `vector` is the already-embedded query; returns up
   * to `limit` chunks ordered by descending similarity. `filter` optionally
   * narrows to one sourceType (e.g. products only).
   */
  similaritySearch(
    vector: number[],
    limit: number,
    filter?: SimilarityFilter,
  ): Promise<ScoredChunk[]>
}
