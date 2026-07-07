# Aesth-ai

A proof-of-concept AI chatbot for an aesthetic-clinic site, built to validate the retrieval approach before porting the core into the production codebase. It runs on **Payload 3 + MongoDB** with a dummy beauty-product dataset from Kaggle, and answers product questions through two different retrieval paths that the model chooses between per question.

The reusable chatbot core lives in [`src/lib/ai-chat/`](src/lib/ai-chat/) and is deliberately decoupled from this repo's data model — see the [docs](#architecture--further-reading) below for how it's meant to be lifted into another project.

---

## What it does

The model is given a set of tools and decides which to reach for based on the question:

- **Deterministic queries** ("list face creams with a rating over 4") → a **DB-filter tool** ([`queryProducts`](src/lib/ai-chat/tools/queryProducts.ts)) the model calls with exact filters (search text, brand, category, min rating, limit). Grounding comes straight from the database rows.
- **Semantic queries** ("what can I use for dry skin?") → a **RAG tool** ([`searchKnowledgeBase`](src/lib/ai-chat/tools/searchKnowledgeBase.ts)) that embeds the query and runs a nearest-neighbour search over a vector store.

Two seams make the engine easy to evaluate and re-target:

- **A/B retrieval seam** — [`RETRIEVAL_MODE`](src/lib/ai-chat/retrieval/mode.ts) (or a per-request `mode`) selects `db` (DB tool only), `rag` (semantic only), or `both` (model picks). The tool registry *is* the switch — no orchestrator branching.
- **Provider-agnostic models** — the chat model ([`resolveModel`](src/lib/ai-chat/providers/resolveModel.ts)) and embedding model ([`resolveEmbeddingModel`](src/lib/ai-chat/providers/resolveEmbeddingModel.ts)) each sit behind a one-line env switch. No business code imports a vendor SDK directly.

The model also self-selects a typed **answer shape** (plain / timeline / product-list / comparison), always degrading to plain text on failure — see [STRUCTURED-OUTPUT.md](src/lib/ai-chat/STRUCTURED-OUTPUT.md).

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) |
| CMS / data | Payload 3.85, MongoDB (Mongoose adapter) |
| Vector search | MongoDB Atlas `$vectorSearch` over a dedicated `embeddings` collection |
| LLM plumbing | Vercel AI SDK (`ai` v7) |
| Chat model | Gemini Flash (`gemini-3.1-flash-lite`) by default — swappable to Claude / GPT |
| Embeddings | `gemini-embedding-001` @ 768 dims (task-type aware: document at index time, query at request time) |

Vectors live in their own [`embeddings`](src/collections/chat/Embeddings.ts) collection keyed by `sourceType` / `sourceId` / `chunkIndex` — never on the product documents — so the catalog schema stays clean and the index is swappable (Atlas → Pinecone/Qdrant/pgvector) behind the [`VectorStore`](src/lib/ai-chat/vector/VectorStore.ts) interface.

---

## Quick start (local)

This project uses **npm**.

1. Copy the env file and fill it in:
   ```bash
   cp .env.example .env
   ```
   At minimum set `DATABASE_URL`, `PAYLOAD_SECRET`, and the provider API key matching `AI_PROVIDER` (default `google` → `GOOGLE_GENERATIVE_AI_API_KEY`).

2. Install and run:
   ```bash
   npm install
   npm run dev
   ```

3. Open `http://localhost:3000` and follow the prompt to create your first admin user.

### Seed data & embeddings

```bash
npm run seed          # load the dummy product catalog
npm run seed:prompt   # seed the active prompt template (product-assistant)
npm run embed         # backfill vectors into the embeddings collection (RAG only)
```

`npm run embed` is only needed to use the RAG path (`RETRIEVAL_MODE=rag` or `both`). It also requires a **MongoDB Atlas `$vectorSearch` index** on `embeddings.vector` (`numDimensions` matching `EMBEDDING_DIMS`, cosine similarity, `sourceType` as a filter). See [ai-chat/README.md](src/lib/ai-chat/README.md) and [PORTING.md](src/lib/ai-chat/PORTING.md) for the one-time Atlas setup.

### Talking to the bot

```bash
curl -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"sessionKey":"demo","message":"what can I use for dry skin?","mode":"both"}'
```

`sessionKey` and `message` are required; `mode` (`db`|`rag`|`both`) and `shapes` are optional per-request overrides.

---

## Configuration

Full detail is in [`.env.example`](.env.example); the knobs you'll most likely touch:

| Var | What it does |
| --- | --- |
| `AI_PROVIDER` / `AI_MODEL` | Chat provider (`google` \| `anthropic` \| `openai`) and optional model-id override. |
| `EMBEDDING_PROVIDER` / `EMBEDDING_MODEL` / `EMBEDDING_DIMS` | Embedding model and vector dimensionality (must match the Atlas index). |
| `RETRIEVAL_MODE` | Default retrieval arm: `db` \| `rag` \| `both`. Overridable per request. |
| `OUTPUT_SHAPES` | Answer-shape allowlist (`plain,timeline,productList,comparison`); `plain` is always forced in. |
| `VECTOR_INDEX_NAME` | Name of the Atlas `$vectorSearch` index on `embeddings`. |
| `EMBED_BATCH` / `EMBED_RPM_DELAY_MS` / `EMBED_LIMIT` | Backfill tuning to stay under the Gemini free-tier quota. |

---

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server. |
| `npm run build` / `npm start` | Production build / serve. |
| `npm run generate:types` | Regenerate `payload-types.ts` after collection changes. |
| `npm run seed` | Load the dummy product catalog. |
| `npm run seed:prompt` | Seed the active prompt template. |
| `npm run embed` | Backfill RAG vectors. |
| `npm run inspect:source` | Inspect the source dataset. |
| `npm run ai:smoke*` | Smoke-test the model / embedding / tool / chat seams in isolation. |
| `npm run lint` | ESLint. |
| `npm run test` | Integration (Vitest) + e2e (Playwright). |

---

## Architecture & further reading

The chatbot core is documented for reuse:

- [`src/lib/ai-chat/README.md`](src/lib/ai-chat/README.md) — the RAG A/B workflow and env detail.
- [`src/lib/ai-chat/PORTING.md`](src/lib/ai-chat/PORTING.md) — which files copy verbatim vs. get rewritten when lifting the core into the production CMS.
- [`src/lib/ai-chat/STRUCTURED-OUTPUT.md`](src/lib/ai-chat/STRUCTURED-OUTPUT.md) — the structured-output seam and why self-select was chosen.

Design rule that keeps porting cheap: **exactly two places touch the outside world** — the Payload data adapter (DB) and the `resolve*` provider files (model SDKs). Everything else talks to interfaces (`ChatDataAdapter`, `VectorStore`, `ToolSet`) and moves without edits.

---

> **Note on the dataset:** the Kaggle product data is a stand-in POC catalog (prices are raw text in IDR, mixing ranges and single values). It exists to exercise the retrieval paths, not as production data.
