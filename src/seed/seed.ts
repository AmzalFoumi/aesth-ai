import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../payload.config'
import { parse } from 'csv-parse/sync'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const CSV_PATH = path.resolve(dirname, '../../products_all_brands.csv')

// Turn "" / whitespace into undefined, otherwise return the trimmed string.
const str = (v: unknown): string | undefined => {
  const s = String(v ?? '').trim()
  return s.length ? s : undefined
}

// Parse a numeric cell; returns undefined for blanks so Payload stores null.
const num = (v: unknown): number | undefined => {
  const s = str(v)
  if (s === undefined) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

const date = (v: unknown): string | undefined => {
  const s = str(v)
  if (s === undefined) return undefined
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

const seed = async () => {
  const payload = await getPayload({ config })

  const raw = fs.readFileSync(CSV_PATH, 'utf-8')
  const rows: Record<string, string>[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
  })

  payload.logger.info(`Parsed ${rows.length} rows from CSV`)

  let created = 0
  let skipped = 0
  const BATCH = 50

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)

    await Promise.all(
      batch.map(async (row) => {
        const productId = num(row.product_id)
        if (productId === undefined) {
          skipped++
          return
        }

        try {
          const existing = await payload.find({
            collection: 'products',
            where: { productId: { equals: productId } },
            limit: 1,
          })

          if (existing.totalDocs > 0) {
            skipped++
            return
          }

          await payload.create({
            collection: 'products',
            data: {
              productId,
              productName: str(row.product_name) ?? 'Untitled',
              brandName: str(row.brand_name),
              url: str(row.url),
              activeDate: date(row.active_date),
              defaultCategory: str(row.default_category),
              categories: str(row.categories)
                ?.split(';')
                .map((c) => c.trim())
                .filter(Boolean),
              priceRange: str(row.price_range),
              priceByCombinations: str(row.price_by_combinations),
              beautyPointEarned: num(row.beauty_point_earned),
              averageRating: num(row.average_rating),
              totalReviews: num(row.total_reviews),
              ratingTypesStr: str(row.rating_types_str),
              averageRatingByTypes: str(row.average_rating_by_types),
              totalRecommendedCount: num(row.total_recommended_count),
              totalRepurchaseMaybeCount: num(row.total_repurchase_maybe_count),
              totalRepurchaseNoCount: num(row.total_repurchase_no_count),
              totalRepurchaseYesCount: num(row.total_repurchase_yes_count),
              totalInWishlist: num(row.total_in_wishlist),
            },
          })
          created++
        } catch (err) {
          skipped++
          payload.logger.error(`Failed on product_id=${productId}: ${(err as Error).message}`)
        }
      }),
    )

    payload.logger.info(`Progress: ${Math.min(i + BATCH, rows.length)}/${rows.length}`)
  }

  payload.logger.info(`Done. Created ${created}, skipped ${skipped}.`)
  process.exit(0)
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
