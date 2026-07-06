import type { CollectionConfig } from 'payload'

// Server-only: written by the backfill script (npm run embed) and read by the RAG tool via the
// Local API. Public REST access is denied; admins can inspect vectors for debugging.
const adminOnly = ({ req }: { req: { user?: unknown } }) => Boolean(req.user)

/**
 * Generalized vector store for RAG. Deliberately NOT products-only: `sourceType` + `sourceId`
 * + `chunkIndex` let one collection hold products now and treatments / posts / testimonials / etc.
 * later (and chunked long text) with no schema change. Structured attributes go in `metadata` for
 * filtering — we embed free text only; exact facets stay in the DB-query tool.
 *
 * The vectors live here (a dedicated collection), never on the domain documents, so the catalog
 * schema stays clean and the whole index is swappable (Atlas → Pinecone/Qdrant) behind the adapter.
 */
export const Embeddings: CollectionConfig = {
  slug: 'embeddings',
  admin: {
    useAsTitle: 'sourceId',
    defaultColumns: ['sourceType', 'sourceId', 'chunkIndex', 'model', 'updatedAt'],
    description:
      'RAG vector store. One row per embedded text chunk. Written by `npm run embed`; queried via Atlas $vectorSearch.',
  },
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  fields: [
    {
      name: 'sourceType',
      type: 'select',
      required: true,
      index: true,
      defaultValue: 'product',
      options: [
        { label: 'Product', value: 'product' },
        { label: 'Treatment', value: 'treatment' },
        { label: 'Post', value: 'post' },
        { label: 'Testimonial', value: 'testimonial' },
        { label: 'Concern', value: 'concern' },
        { label: 'Category', value: 'category' },
        { label: 'Author', value: 'author' },
        { label: 'Page', value: 'page' },
      ],
      admin: { description: 'Which kind of source document this vector came from.' },
    },
    {
      name: 'sourceId',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'Id of the parent document (e.g. productId) this chunk belongs to.' },
    },
    {
      name: 'chunkIndex',
      type: 'number',
      required: true,
      defaultValue: 0,
      admin: { description: '0 for single-chunk docs; 0,1,2… when long text is split into passages.' },
    },
    {
      name: 'text',
      type: 'textarea',
      required: true,
      admin: { description: 'The exact text that was embedded (kept for traceability + re-embedding).' },
    },
    {
      name: 'vector',
      type: 'json',
      required: true,
      admin: { description: 'The embedding vector (array of floats). Indexed by Atlas $vectorSearch.' },
    },
    {
      name: 'metadata',
      type: 'json',
      admin: { description: 'Filter facets (brand, category, rating, url, title…). NOT embedded.' },
    },
    {
      name: 'model',
      type: 'text',
      required: true,
      index: true,
      admin: { description: 'Embedding model id (e.g. gemini-embedding-001) — lets us re-embed on change.' },
    },
    {
      name: 'dims',
      type: 'number',
      required: true,
      admin: { description: 'Vector dimensionality — must match the Atlas index (e.g. 768).' },
    },
  ],
}
