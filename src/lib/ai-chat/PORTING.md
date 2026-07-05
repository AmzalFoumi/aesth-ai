# Porting the ai-chat core into another project

This folder was built to be lifted into a **separate repo** (the production CMS
with real Luxskin data). This document tells the receiving AI agent — or human —
**which files copy verbatim and which must be rewritten for the target
architecture.** Read it top-to-bottom before moving anything.

The design rule that makes porting cheap: **exactly two files touch the outside
world.** `data/payloadChatAdapter.ts` is the only file importing `payload`/the DB,
and the `providers/resolve*` files are the only ones importing a model SDK.
Everything else talks to interfaces (`ChatDataAdapter`, `VectorStore`, `ToolSet`)
and moves without edits.

---

## Legend

- 🟢 **Copy as-is** — framework-agnostic; no edits expected.
- 🟡 **Copy + tune** — copies, but has knobs/wording you'll likely adjust.
- 🔴 **Rewrite per project** — bound to *this* repo's data model; expect real work.

---

## The ai-chat core (`src/lib/ai-chat/`)

| File | Class | Notes |
| --- | --- | --- |
| `orchestrator.ts` | 🟢 | The one entry point. Pure glue over the interfaces. |
| `types.ts` | 🟢 | Shared shapes. Add source types / fields as the target needs (additive). |
| `index.ts` | 🟢 | Public surface. |
| `retrieval/mode.ts` | 🟢 | `db`/`rag`/`both` resolver. Env-driven, data-agnostic. |
| `vector/VectorStore.ts` | 🟢 | Interface only. |
| `guardrails/*` | 🟡 | Copies fine; review `inputRules` off-topic/injection wording and rate-limit numbers for the target domain. |
| `prompts/render.ts` | 🟢 | `{{placeholder}}` substitution. |
| `providers/resolveModel.ts` | 🟡 | Copies; set `AI_PROVIDER`/`AI_MODEL` for the target. |
| `providers/resolveEmbeddingModel.ts` | 🟡 | Copies; set `EMBEDDING_*`. Keep dims in sync with the Atlas index. |
| `tools/index.ts` | 🟢 | `buildTools(adapter, mode)` — registers by mode; no data coupling. |
| `tools/searchKnowledgeBase.ts` | 🟡 | Copies. The `sourceType` enum and default filter reflect what you embedded — widen it once the target has treatments/posts/pages. |
| `tools/queryProducts.ts` | 🔴 | Its args (`brandName`, `category`, `minRating`) describe *this* catalog. Rewrite the schema + description to the target's queryable facets. |
| `data/ChatDataAdapter.ts` | 🟡 | Interface. Keep the method **shapes**; the `queryProducts` arg/return types change with the domain. |
| `data/payloadChatAdapter.ts` | 🔴 | **The big one.** See below. |
| `*/smokeTest.ts`, `smokeTest.ts` | 🟡 | Dev scripts; keep for verification, retarget collection/field names. |

### `data/payloadChatAdapter.ts` — the rewrite hotspot

It has two halves that port very differently:

- **Chat plumbing** (`getOrCreateSession`, `getRecentMessages`, `saveMessage`,
  `getActivePromptTemplate`) — 🟢 essentially copyable **if** you also bring the
  three chat collections (below) with the same field names. These only ever touch
  `chat-sessions` / `chat-messages` / `prompt-templates`.
- **`queryProducts`** — 🔴 rewrite. The `Where` clause names this repo's product
  fields (`productName`, `brandName`, `defaultCategory`, `categories`,
  `averageRating`). Map to the target collection + fields.
- **`upsertEmbeddings` / `similaritySearch`** — 🟢 copyable **as long as the target
  is MongoDB Atlas.** They use the raw Mongo driver via
  `payload.db.connection.collection('embeddings')` and the `$vectorSearch` stage.
  - If the target DB is **Postgres** (Payload supports it) → 🔴 these two methods
    must be rewritten (pgvector, or an external vector DB adapter). Nothing else in
    the core changes — that's the point of the `VectorStore` seam.
  - `VECTOR_INDEX_NAME` must match the index you create in Atlas.

---

## Host-app files (NOT in the core, but needed)

| File | Class | Notes |
| --- | --- | --- |
| `collections/chat/ChatSessions.ts` | 🟢 | Copy; register in the target's `payload.config.ts`. |
| `collections/chat/Messages.ts` | 🟢 | Copy (incl. the `retrievalMode` field). Register. |
| `collections/chat/PromptTemplates.ts` | 🟢 | Copy. Register. Then re-seed a prompt. |
| `collections/chat/Embeddings.ts` | 🟢 | Copy. Register. Generalized shape already fits products + treatments/posts/pages. |
| `collections/chat/index.ts` | 🟢 | Barrel — copy. |
| `seed/seedPrompt.ts` | 🟡 | Copy; **rewrite the prompt text** for the target's domain/brand. |
| `seed/embed.ts` | 🔴 | **The least portable file.** See below. |
| `app/chat/route.ts` | 🟢 | HTTP adapter. Copy; only depends on `runChat`. |
| `app/(frontend)/components/ChatWidget.tsx` | 🟡 | Copy; restyle to the target's design. The `mode` toggle + `body.mode` contract stay. |

### `seed/embed.ts` — rewrite the ingestion, keep the skeleton

The **loop, batching, resume-safety, and rate-limit handling are 🟢 reusable**.
What's 🔴 is **what gets embedded**:

1. `buildBlob(p)` reads *this* catalog's fields. Rewrite it to synthesize text from
   the target's fields.
2. `payload.find({ collection: 'products', select: {...} })` — change the collection
   and `select` to the target's.
3. The prod DB uses **Lexical rich-text** (nested JSON) for descriptions/blog bodies,
   **not** plain strings. You **cannot** embed the Lexical JSON directly — first
   flatten it to plain text (walk the Lexical node tree collecting `text` nodes, or
   use `@payloadcms/richtext-lexical`'s converters). This flattened text is what
   `chunkText()` then splits.
4. **Drafts/versions:** filter to published docs (`where: { _status: { equals:
   'published' } }`) so you don't embed unpublished drafts.
5. `vector/chunkText.ts` currently returns `[text]` (one chunk). Real descriptions
   and blog bodies are long → implement actual chunking here (overlapping
   ~300–500-token passages). **No caller changes** — `embed.ts` and the adapter
   already loop over whatever it returns via `chunkIndex`.

---

## Recipe: add a new source type (e.g. `treatment`, `post`, `page`)

The schema already supports this with **no migration** — that's why `Embeddings` is
generalized. To make treatments searchable:

1. `types.ts` — `SourceType` already lists `treatment`/`post`/`page`; add any missing
   ones there.
2. `seed/embed.ts` — add a pass that `payload.find`s that collection, builds a blob
   (flattening Lexical if the body is rich text), and pushes `EmbeddingItem`s tagged
   `sourceType: 'treatment'`. Re-run `npm run embed`.
3. `tools/searchKnowledgeBase.ts` — add the new value to the `sourceType` enum so the
   model can narrow to it (or leave the default cross-type search).
4. The Atlas index already covers the whole `embeddings` collection and filters on
   `sourceType` — nothing to change there.

---

## One-time target setup checklist

1. Copy the files per the tables above; register the four chat collections in the
   target `payload.config.ts`.
2. Set env: `AI_PROVIDER`/`AI_MODEL`, provider API key, `EMBEDDING_*`,
   `VECTOR_INDEX_NAME`, `RETRIEVAL_MODE`. (See the README config table.)
3. Create the Atlas `$vectorSearch` index on `embeddings.vector` — `numDimensions`
   matching `EMBEDDING_DIMS`, `similarity: cosine`, `sourceType` as a filter field —
   named to match `VECTOR_INDEX_NAME`. Wait for status **Active**.
4. `npm run seed:prompt` (target-specific prompt) → seed/import the real data →
   `npm run embed`.
5. Smoke it: `curl … {"mode":"rag", …}` and confirm `chat-messages.retrievalMode` is
   stamped.

See [README.md](./README.md) for env details and the RAG A/B workflow.
