import type { Payload, Where } from 'payload'
import type { ChatDataAdapter } from './ChatDataAdapter'
import type {
  EmbeddingItem,
  MessageRecord,
  NewMessage,
  ProductQueryArgs,
  ProductSummary,
  ScoredChunk,
  SessionRecord,
  SimilarityFilter,
  SourceType,
} from '../types'

// Name of the Atlas Search index created once in the Atlas UI on the `embeddings`
// collection (768 dims, cosine, with `sourceType` declared as a filter field).
const VECTOR_INDEX = process.env.VECTOR_INDEX_NAME ?? 'vector_index'

/**
 * The native MongoDB driver collection behind Payload's mongoose adapter. We drop
 * to the raw collection ONLY for the two vector operations that Payload's Local API
 * can't express: the `$vectorSearch` aggregation stage (Atlas-specific) and the
 * batched delete+insert upsert. Everything else still goes through payload.*.
 */
const mongoCollection = (payload: Payload, name: string) => {
  const connection = (payload.db as unknown as { connection?: { collection: (n: string) => any } })
    .connection
  if (!connection) {
    throw new Error('Vector ops require the MongoDB (mongoose) adapter — no connection found.')
  }
  return connection.collection(name)
}

/**
 * The ONLY file in the ai-chat core allowed to import `payload`. Everything else
 * talks to the ChatDataAdapter interface, so swapping the DB (or the whole backend)
 * only touches this file.
 */
export const createPayloadChatAdapter = (payload: Payload): ChatDataAdapter => ({
  async getOrCreateSession(sessionKey, templateKey) {
    const existing = await payload.find({
      collection: 'chat-sessions',
      where: { sessionKey: { equals: sessionKey } },
      limit: 1,
    })

    const doc =
      existing.docs[0] ??
      (await payload.create({
        collection: 'chat-sessions',
        data: { sessionKey, promptTemplateKey: templateKey, status: 'active' },
      }))

    return {
      id: String(doc.id),
      sessionKey: doc.sessionKey,
      promptTemplateKey: doc.promptTemplateKey ?? undefined,
      status: (doc.status ?? 'active') as SessionRecord['status'],
    }
  },

  async getRecentMessages(sessionId, limit) {
    const res = await payload.find({
      collection: 'chat-messages',
      where: { session: { equals: sessionId } },
      sort: '-createdAt',
      limit,
      depth: 0,
    })

    // Oldest-first for the model; keep only conversational turns.
    return res.docs
      .reverse()
      .filter((d) => d.role === 'user' || d.role === 'assistant')
      .map(
        (d): MessageRecord => ({
          id: String(d.id),
          role: d.role as MessageRecord['role'],
          content: d.content ?? '',
        }),
      )
  },

  async saveMessage(msg: NewMessage) {
    await payload.create({
      collection: 'chat-messages',
      data: {
        session: msg.session,
        role: msg.role,
        content: msg.content,
        toolCalls: msg.toolCalls ?? undefined,
        toolResults: msg.toolResults ?? undefined,
        guardrailFlags: msg.guardrailFlags ?? undefined,
        tokenUsage: msg.tokenUsage ?? undefined,
        retrievalMode: msg.retrievalMode ?? undefined,
      },
    })
  },

  async getActivePromptTemplate(key) {
    const res = await payload.find({
      collection: 'prompt-templates',
      where: { key: { equals: key }, isActive: { equals: true } },
      sort: '-version',
      limit: 1,
    })
    const doc = res.docs[0]
    if (!doc) return null
    return { systemPrompt: doc.systemPrompt, version: doc.version ?? 1 }
  },

  async queryProducts(args: ProductQueryArgs) {
    const and: Where[] = []

    if (args.search) {
      and.push({
        or: [
          { productName: { contains: args.search } },
          { brandName: { contains: args.search } },
        ],
      })
    }
    if (args.brandName) and.push({ brandName: { contains: args.brandName } })
    if (args.category) {
      and.push({
        or: [
          { defaultCategory: { contains: args.category } },
          { categories: { contains: args.category } },
        ],
      })
    }
    if (typeof args.minRating === 'number') {
      and.push({ averageRating: { greater_than_equal: args.minRating } })
    }

    const where: Where = and.length ? { and } : {}

    const res = await payload.find({
      collection: 'products',
      where,
      limit: Math.min(args.limit ?? 5, 10),
      sort: '-averageRating',
      depth: 0,
      select: {
        productName: true,
        brandName: true,
        defaultCategory: true,
        priceRange: true,
        averageRating: true,
        totalReviews: true,
        url: true,
      },
    })

    return res.docs.map(
      (d): ProductSummary => ({
        productName: d.productName,
        brandName: d.brandName ?? undefined,
        defaultCategory: d.defaultCategory ?? undefined,
        priceRange: d.priceRange ?? undefined,
        averageRating: d.averageRating ?? undefined,
        totalReviews: d.totalReviews ?? undefined,
        url: d.url ?? undefined,
      }),
    )
  },

  // --- VectorStore half (RAG) -------------------------------------------------

  async upsertEmbeddings(items: EmbeddingItem[]) {
    if (items.length === 0) return
    const col = mongoCollection(payload, 'embeddings')
    const now = new Date()

    // Idempotent by (sourceType, sourceId, chunkIndex): replace the row for each
    // key so re-running the backfill refreshes vectors without duplicating.
    const ops = items.map((it) => ({
      updateOne: {
        filter: {
          sourceType: it.sourceType,
          sourceId: it.sourceId,
          chunkIndex: it.chunkIndex,
        },
        update: {
          $set: {
            sourceType: it.sourceType,
            sourceId: it.sourceId,
            chunkIndex: it.chunkIndex,
            text: it.text,
            vector: it.vector,
            metadata: it.metadata ?? null,
            model: it.model,
            dims: it.dims,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        upsert: true,
      },
    }))

    await col.bulkWrite(ops, { ordered: false })
  },

  async similaritySearch(vector: number[], limit: number, filter?: SimilarityFilter) {
    const col = mongoCollection(payload, 'embeddings')

    const vectorSearch: Record<string, unknown> = {
      index: VECTOR_INDEX,
      path: 'vector',
      queryVector: vector,
      // numCandidates: Atlas guidance is ~10-20x the requested limit for good recall.
      numCandidates: Math.max(limit * 15, 100),
      limit,
    }
    if (filter?.sourceType) {
      vectorSearch.filter = { sourceType: { $eq: filter.sourceType } }
    }

    const docs = await col
      .aggregate([
        { $vectorSearch: vectorSearch },
        {
          $project: {
            _id: 0,
            sourceType: 1,
            sourceId: 1,
            chunkIndex: 1,
            text: 1,
            metadata: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ])
      .toArray()

    return docs.map(
      (d: any): ScoredChunk => ({
        sourceType: d.sourceType as SourceType,
        sourceId: String(d.sourceId),
        chunkIndex: Number(d.chunkIndex ?? 0),
        text: d.text ?? '',
        metadata: d.metadata ?? undefined,
        score: Number(d.score ?? 0),
      }),
    )
  },
})
