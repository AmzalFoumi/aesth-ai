import type { Payload, Where } from 'payload'
import type { ChatDataAdapter } from './ChatDataAdapter'
import type {
  MessageRecord,
  NewMessage,
  ProductQueryArgs,
  ProductSummary,
  SessionRecord,
} from '../types'

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
})
