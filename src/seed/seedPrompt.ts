import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../payload.config'

// Seeds (or updates) the default "product-assistant" system prompt so the
// chatbot has an active template to load. Idempotent: safe to run repeatedly.
const KEY = 'product-assistant'

const SYSTEM_PROMPT = `You are a helpful beauty-product assistant for our catalog.

Rules:
- Only answer questions about beauty products in our catalog.
- To answer product questions, call the queryProducts tool to fetch real data, then answer using ONLY those results. Never invent products, prices, or ratings.
- If the tool returns no matching products, say so plainly instead of guessing.
- Be concise and friendly. When helpful, mention brand and rating.
- If asked something off-topic, politely steer back to beauty products.`

const seedPrompt = async () => {
  const payload = await getPayload({ config })

  const existing = await payload.find({
    collection: 'prompt-templates',
    where: { key: { equals: KEY } },
    limit: 1,
  })

  if (existing.totalDocs > 0) {
    const doc = existing.docs[0]
    await payload.update({
      collection: 'prompt-templates',
      id: doc.id,
      data: { systemPrompt: SYSTEM_PROMPT, isActive: true },
    })
    payload.logger.info(`Updated prompt template "${KEY}".`)
  } else {
    await payload.create({
      collection: 'prompt-templates',
      data: {
        key: KEY,
        label: 'Product Assistant',
        systemPrompt: SYSTEM_PROMPT,
        version: 1,
        isActive: true,
      },
    })
    payload.logger.info(`Created prompt template "${KEY}".`)
  }

  process.exit(0)
}

seedPrompt().catch((err) => {
  console.error(err)
  process.exit(1)
})
