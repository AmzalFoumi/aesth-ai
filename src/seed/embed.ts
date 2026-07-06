import 'dotenv/config'
import { getPayload } from 'payload'
import { embedMany } from 'ai'
import config from '../payload.config'
import { createPayloadChatAdapter } from '../lib/ai-chat/data/payloadChatAdapter'
import { chunkText } from '../lib/ai-chat/vector/chunkText'
import { resolveEmbeddingModel, embeddingDims, embeddingModelId } from '../lib/ai-chat/providers/resolveEmbeddingModel'
import type { EmbeddingItem } from '../lib/ai-chat/types'

/**
 * Standalone RAG backfill — the vector-store twin of `npm run seed`.
 *
 *   npm run embed
 *
 * Reads every product via the Local API (DB-agnostic), synthesizes ONE short text
 * blob per product, embeds the blobs with Gemini in batches, and upserts the vectors
 * into the `embeddings` collection through the adapter (Atlas $vectorSearch).
 *
 * Deliberate design (see .claude/plans/rag-phase-2-plan.md, Step 4):
 *  - SEPARATE step, never runs on write → can't blow the Gemini quota or slow admin.
 *  - IDEMPOTENT by (sourceType, sourceId, chunkIndex) → safe to re-run after re-seeding.
 *  - RESUME-SAFE: skips products that already have a vector for the CURRENT model, so a
 *    large prod copy can be embedded across several runs/days without redoing work.
 *  - FREE-TIER AWARE: Gemini free tier counts ~100 EMBEDDINGS/min (not HTTP calls) and
 *    1,000/day. We embed <=EMBED_BATCH per request and pause EMBED_RPM_DELAY_MS between
 *    batches. EMBED_LIMIT caps total products this run (handy for a quick demo subset).
 */

const DIMS = embeddingDims()
const MODEL_ID = embeddingModelId()
const EMBED_BATCH = Number(process.env.EMBED_BATCH ?? 90) // per-request, under the 100/min ceiling
const EMBED_RPM_DELAY_MS = Number(process.env.EMBED_RPM_DELAY_MS ?? 60_000) // pause between batches
const EMBED_LIMIT = process.env.EMBED_LIMIT ? Number(process.env.EMBED_LIMIT) : Infinity

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// The text we actually embed. Keep it compact and meaning-bearing — exact facets
// (brand=, rating>=) stay in the DB-query tool; RAG is for fuzzy/semantic matches.
const buildBlob = (p: Record<string, unknown>): string => {
  const parts = [
    p.productName,
    p.brandName ? `brand: ${p.brandName}` : undefined,
    p.defaultCategory ? `category: ${p.defaultCategory}` : undefined,
    Array.isArray(p.categories) && p.categories.length ? `also: ${(p.categories as string[]).join(', ')}` : undefined,
    typeof p.averageRating === 'number' ? `rating: ${p.averageRating} (${p.totalReviews ?? 0} reviews)` : undefined,
    p.priceRange ? `price: ${p.priceRange}` : undefined,
  ]
  return parts.filter(Boolean).join(' | ')
}

const main = async () => {
  const payload = await getPayload({ config })
  const adapter = createPayloadChatAdapter(payload)

  // 1. Fail loudly if there's nothing to embed (embed must run AFTER seed).
  const total = await payload.count({ collection: 'products' })
  if (total.totalDocs === 0) {
    throw new Error('No products found — run `npm run seed` before `npm run embed`.')
  }
  payload.logger.info(`Embedding backfill: ${total.totalDocs} products | model=${MODEL_ID} dims=${DIMS}`)

  // 2. Resume-safe: collect productIds that already have a current-model vector so we skip them.
  const embCol = (payload.db as any).connection.collection('embeddings')
  const doneIds = new Set<string>(
    (await embCol.distinct('sourceId', { sourceType: 'product', model: MODEL_ID })).map(String),
  )
  payload.logger.info(`Already embedded (current model): ${doneIds.size} — will skip these.`)

  const model = resolveEmbeddingModel()
  let embedded = 0
  let skipped = 0
  let page = 1
  const pending: { sourceId: string; text: string; metadata: Record<string, unknown> }[] = []

  // Flush = embed the currently-buffered blobs (one API request) and upsert the vectors.
  const flush = async () => {
    if (pending.length === 0) return
    const { embeddings } = await embedMany({
      model,
      values: pending.map((x) => x.text),
      providerOptions: { google: { outputDimensionality: DIMS, taskType: 'RETRIEVAL_DOCUMENT' } },
    })
    const items: EmbeddingItem[] = pending.map((x, i) => ({
      sourceType: 'product',
      sourceId: x.sourceId,
      chunkIndex: 0,
      text: x.text,
      vector: embeddings[i],
      metadata: x.metadata,
      model: MODEL_ID,
      dims: DIMS,
    }))
    await adapter.upsertEmbeddings(items)
    embedded += items.length
    payload.logger.info(`  embedded ${embedded} (this batch ${items.length})`)
    pending.length = 0
  }

  // 3. Page through products, buffer blobs, flush at EMBED_BATCH with a quota pause.
  outer: while (true) {
    const res = await payload.find({
      collection: 'products',
      limit: 100,
      page,
      depth: 0,
      select: {
        productId: true,
        productName: true,
        brandName: true,
        defaultCategory: true,
        categories: true,
        priceRange: true,
        averageRating: true,
        totalReviews: true,
        url: true,
      },
    })

    for (const p of res.docs as Record<string, unknown>[]) {
      const sourceId = String(p.productId)
      if (doneIds.has(sourceId)) {
        skipped++
        continue
      }
      if (embedded + pending.length >= EMBED_LIMIT) break outer

      for (const text of chunkText(buildBlob(p))) {
        pending.push({
          sourceId,
          text,
          metadata: {
            brand: p.brandName ?? null,
            category: p.defaultCategory ?? null,
            rating: p.averageRating ?? null,
            reviews: p.totalReviews ?? null,
            priceRange: p.priceRange ?? null,
            url: p.url ?? null,
          },
        })
      }

      if (pending.length >= EMBED_BATCH) {
        await flush()
        if (embedded >= EMBED_LIMIT) break outer
        payload.logger.info(`  …pausing ${EMBED_RPM_DELAY_MS}ms for free-tier rate limit`)
        await sleep(EMBED_RPM_DELAY_MS)
      }
    }

    if (!res.hasNextPage) break
    page++
  }

  await flush() // final partial batch

  payload.logger.info(`Done. Embedded ${embedded}, skipped ${skipped} (already current).`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
