import 'dotenv/config'
import { MongoClient } from 'mongodb'

/**
 * READ-ONLY inspector for the prod-copy database (the mentor's clinic DB).
 *
 * It connects to SOURCE_DATABASE_URI — a SEPARATE var from the app's DATABASE_URL, so the app keeps
 * running on its own DB — lists every collection, counts docs, and prints ONE sample document per
 * collection so we can see the real field shapes and decide what text to embed for RAG.
 *
 * It performs ZERO writes (only listCollections / countDocuments / findOne). Safe to run repeatedly.
 *
 *   npm run inspect:source
 */
const MAX_STR = 200 // truncate long text fields so the console stays readable

// Shorten long strings and deep structures so a 7 kB treatment doc prints legibly.
const truncate = (value: unknown, depth = 0): unknown => {
  if (typeof value === 'string') {
    return value.length > MAX_STR ? `${value.slice(0, MAX_STR)}… (${value.length} chars)` : value
  }
  if (Array.isArray(value)) {
    if (depth >= 3) return `[Array(${value.length})]`
    return value.slice(0, 3).map((v) => truncate(v, depth + 1))
  }
  if (value && typeof value === 'object') {
    if (depth >= 4) return '{…}'
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = truncate(v, depth + 1)
    return out
  }
  return value
}

const main = async () => {
  const uri = process.env.SOURCE_DATABASE_URI
  if (!uri) {
    console.error('Set SOURCE_DATABASE_URI in .env (the prod-copy connection string) first.')
    process.exit(1)
  }

  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db() // uses the db name embedded in the URI
  console.log(`Connected to source DB: "${db.databaseName}"\n`)

  const collections = await db.listCollections().toArray()
  collections.sort((a, b) => a.name.localeCompare(b.name))

  for (const { name } of collections) {
    const coll = db.collection(name)
    const count = await coll.countDocuments()
    console.log(`\n══════════ ${name}  (${count} docs) ══════════`)
    if (count === 0) continue
    const sample = await coll.findOne({})
    console.log('field keys:', Object.keys(sample ?? {}).join(', '))
    console.log('sample doc:', JSON.stringify(truncate(sample), null, 2))
  }

  await client.close()
  process.exit(0)
}

main().catch((err) => {
  console.error('Inspection failed:', err)
  process.exit(1)
})
