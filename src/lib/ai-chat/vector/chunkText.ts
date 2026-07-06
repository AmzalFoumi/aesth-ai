/**
 * The chunking seam. Long documents must be split into passages before embedding
 * (an embedding blurs meaning across too much text, and models cap input length).
 *
 * Right now every source is a short synthesized blob (one product = a few facts),
 * so chunking is a no-op: one text → one chunk. This function exists SO THAT when
 * the CMS prod DB arrives with long product descriptions and blog articles, we turn
 * this into a real splitter (≈400-token overlapping passages) and NO caller changes —
 * the backfill already loops over whatever chunks come back and tags them chunkIndex.
 */
export const chunkText = (text: string): string[] => {
  const t = text.trim()
  return t.length ? [t] : []
}
