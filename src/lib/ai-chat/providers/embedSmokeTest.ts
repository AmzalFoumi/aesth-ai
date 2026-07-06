import 'dotenv/config'
import { embed, embedMany } from 'ai'
import { resolveEmbeddingModel, embeddingDims, embeddingModelId } from './resolveEmbeddingModel'

// Throwaway verification for Step 1. Proves three things before we build the backfill:
//   1. the embedding resolver returns a working model (single embed → vector of the right length),
//   2. gemini-embedding-001 returns ONE vector PER input for a list (real per-item batching,
//      not a single aggregated vector — the whole reason we picked -001 over -2),
//   3. embedMany bundles up to 100 texts per batchEmbedContents call, BUT the free-tier quota
//      (EmbedContentRequestsPerMinutePerUserPerProjectPerModel = 100) counts EACH embedded item,
//      not each HTTP call. Verified empirically: embedMany(250) → HTTP 429. So the real ceiling is
//      ~100 embeddings/MINUTE, and Step 4 must throttle to stay under it (and be resume-safe for a
//      large catalog). We therefore embed only a small, quota-safe batch here.
//
//   npm run ai:smoke:embed
const DIMS = embeddingDims()

const main = async () => {
  const model = resolveEmbeddingModel()
  console.log(`[embedding model=${embeddingModelId()} dims=${DIMS}]`)

  // 1. single embed
  const one = await embed({
    model,
    value: 'hello',
    providerOptions: { google: { outputDimensionality: DIMS, taskType: 'RETRIEVAL_QUERY' } },
  })
  console.log(`single embed -> vector.length = ${one.embedding.length} (expect ${DIMS})`)

  // 2. per-item vs aggregated: a 3-item list must return 3 vectors
  const few = await embedMany({
    model,
    values: ['gentle cleanser', 'bright red lipstick', 'anti-aging night serum'],
    providerOptions: { google: { outputDimensionality: DIMS, taskType: 'RETRIEVAL_DOCUMENT' } },
  })
  console.log(
    `embedMany(3) -> ${few.embeddings.length} vectors` +
      (few.embeddings.length === 3 ? ' ✅ per-item' : ' ❌ AGGREGATED — wrong model!'),
  )

  // 3. quota-safe batch: 90 items sits under the 100/min free-tier ceiling (single+few already
  //    consumed 4 this minute). embedMany bundles these into one batchEmbedContents HTTP call.
  const N = 90
  const big = Array.from({ length: N }, (_, i) => `dummy product number ${i}`)
  const start = Date.now()
  const many = await embedMany({
    model,
    values: big,
    providerOptions: { google: { outputDimensionality: DIMS, taskType: 'RETRIEVAL_DOCUMENT' } },
  })
  const ms = Date.now() - start
  console.log(
    `embedMany(${N}) -> ${many.embeddings.length} vectors in ${ms}ms.\n` +
      `Constraint learned: free tier counts ~100 EMBEDDINGS/minute (not HTTP calls). ` +
      `Backfill of ~7,500 products must throttle to <100/min (~75+ min) and be resume-safe.`,
  )

  process.exit(0)
}

main().catch((err) => {
  console.error('Embedding smoke test failed:', err)
  process.exit(1)
})
