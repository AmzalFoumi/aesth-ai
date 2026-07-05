# AI Chatbot — Phase 2: RAG (Option B) + A/B Retrieval Modes

> Additive to the shipped DB-query chatbot. Nothing in `src/lib/ai-chat/` changes its
> public shape; RAG slots in exactly where §7 of `.claude/ai-chatbot-plan.md` said it would.
> **GIT IS 100% MANUAL** — Claude never runs git and STOPS at every 🛑 gate with a ready-to-paste
> commit message, exactly like Phase 1.

---

## Context — why we're doing this

Your mentor asked you to **duplicate the working chatbot, try it with RAG, then A/B test the two**.
The current bot grounds answers with **exact database filters** (`brandName contains X`,
`averageRating >= 4`) via the `queryProducts` tool. That is great for structured questions and
bad for meaning-based ones ("something gentle for sensitive skin"). **RAG** adds a second
retrieval path: turn text into **embeddings** (number-lists that capture meaning), store them in a
**vector store**, and at query time find the closest matches *by meaning* instead of exact words.

We are building **Option B**: embeddings via **Gemini** (reuses your existing `@ai-sdk/google`
key and free tier), vectors stored in **MongoDB Atlas Vector Search** (`$vectorSearch`, free on M0),
querying with a vector we compute ourselves. No new provider, no second database platform, one
env change to swap later.

**Embedding model choice (verified against current Gemini docs):** use **`gemini-embedding-001`**
at **768 dimensions**, NOT "Gemini Embedding 2". Reason: `gemini-embedding-001` *"generates
individual embeddings for a list of strings"* — pass 100 product blobs in one request, get 100
vectors back (real batching). `gemini-embedding-2` *"produces a single aggregated embedding for
multiple inputs"* — a list collapses to one blended vector, forcing 1 request per product. So the
older model is the correct one for backfilling a catalog. `text-embedding-004` (a legacy Google
model) is **not** used — `gemini-embedding-001` already batches.

**How many requests will the backfill make?** For ~7,500 products (your current dummy DB; prod copy
unknown): tokens are never the constraint (~40 tokens/blob ≈ 300K total). Requests are. With
`embedMany` batching ~100 blobs/request → **~75 requests**, ~1 minute, far inside the free tier's
daily request cap. Live chat afterward embeds only the user's question = **1 request per message**.
The exact `maxEmbeddingsPerCall` for `gemini-embedding-001` in `@ai-sdk/google` is confirmed in
Step 1 and the batch size set to match; Step 4 is resume-safe so a large prod copy can span days if
a per-request cap ever forces 1/row.

**Why not `gemini-embedding-2` or the Batch API for this demo?** Embedding 2 returns *one aggregated
vector* for a plain list of inputs (per-item vectors require wrapping each text in a `Content` object
or the Batch API) — extra work with a real risk of silently getting aggregated output. The Batch API
*does* do per-item embeddings for Embedding 2 at 50% cost, but its **free-tier availability is not
documented** (rate-limit page lists batch limits only for paid Tiers 1–3) and it's async (up to 24h,
plus Files-API upload + job polling + JSONL parsing) and would require Google-specific code outside
the resolver, breaking the agnostic seam. For a **must-stay-free demo**, synchronous
`gemini-embedding-001` is the safe, simple choice. Batch API + Embedding 2 is recorded only as a
**paid-tier fallback** for a very large prod catalog.

**The A/B requirement** is met with a **retrieval mode** the bot runs in:
`db` (only `queryProducts`) · `rag` (only `searchKnowledgeBase`) · `both` (both tools registered).
Set a global default with `RETRIEVAL_MODE`, override per request. This is the seam that lets a
future client ship **just one** of the three without touching core code.

> **Is "enable db / rag / both" the correct way to A/B test?** Partly — clarify the vocabulary:
> - **A/B test proper** = compare `db` vs `rag` as two *separate* arms and judge which answers
>   better. Our mode switch gives you exactly this: run the same questions under `mode:"db"` then
>   `mode:"rag"` and compare. Every answer already logs `toolCalls`/`toolResults` to
>   `chat-messages`, and we'll also stamp the mode, so the comparison is auditable.
> - **`both`** is *not* an A/B arm — it's a **combined product mode** where the model has both tools
>   and picks. Keep it as a real third option (some clients will want it), but don't use it *as* the
>   comparison. For the mentor demo, compare `db` vs `rag`; show `both` as the "why not have it all"
>   option.
> A stricter A/B (random per-session assignment, dashboards) is a later refinement; the mode switch
> is the right first step and keeps everything decoupled.

---

## Two intern-level walkthroughs (read before the steps)

### Flow 1 — Ingestion: getting product data into the vector store (offline, run manually)
```
npm run embed
  1. payload.find({ collection: 'products' })            ← read catalog via Local API (DB-agnostic)
  2. for each product: build ONE text blob               ← "Garnier Micellar Water | brand: Garnier
                                                             | category: Cleanser | rating: 4.6 (1200 reviews)"
  3. embedMany({ model: resolveEmbeddingModel(), values: blobs })   ← Gemini turns text → vectors (batched)
  4. adapter.upsertEmbeddings([{ productId, text, vector }, ...])   ← store vectors in Atlas
```
This is a **separate, deliberate step** — just like `npm run seed`. It does NOT run on every write,
so it can't blow your Gemini quota or slow the admin panel. You re-run it when the catalog changes.

### Flow 2 — Search: answering a user question with RAG (online, per chat)
```
POST /chat { sessionKey, message, mode: "rag" }
  runChat()                                              ← UNCHANGED orchestrator
    └─ generateText({ tools: buildTools(adapter, mode) })   ← mode decides which tools exist
         model decides to call searchKnowledgeBase("gentle for sensitive skin")
           └─ tool.execute:
                1. embed(query) with Gemini              ← same model as ingestion, ONE vector
                2. adapter.similaritySearch(vector, 5)   ← Atlas $vectorSearch returns nearest products
                3. return those rows to the model        ← grounding = semantic matches
         model writes the final sentence from those rows
    └─ output guardrails + persist (now also stamps mode)
```
Key insight: **RAG changes only *how facts are fetched*** (semantic vs exact). Guardrails, prompt
template, history, persistence, and the HTTP contract are all identical to the DB-query path.

---

## Storage decision (chosen): generalized `embeddings` collection

### Option 1 — Separate, generalized `embeddings` collection  ✅ recommended (chosen)
```
embeddings (new Mongo collection — generalized, not products-only)
  sourceType  (select, index)  → 'product' | 'blog' | 'page'  (extensible for the CMS prod DB)
  sourceId    (text, index)    → the parent doc id (productId for products)
  chunkIndex  (number)         → 0 for single-chunk products; 0,1,2... for chunked long text later
  text        (textarea)       → the exact passage we embedded (traceability)
  vector      (json/number[])  → the embedding, 768 floats
  metadata    (json)           → FILTER facets (brand, category, rating, url, title) — NOT embedded
  model       (text)           → "gemini-embedding-001" (so we can re-embed on model change)
  dims        (number)         → 768
```
**Why generalized (not `product-embeddings`):** the incoming prod DB (Payload CMS) will bring product
descriptions **plus blog articles and website pages**. This shape lets `searchKnowledgeBase` search
**across** all sources or filter to one via `sourceType`, and lets long text be **chunked later**
(`chunkIndex`) with **no schema change**. Structured attributes live in `metadata` for filtering — we
embed free text only, and let the existing `queryProducts` DB filter handle exact facets.
**Granularity now:** one embedding per product (composed text blob), `chunkIndex = 0`. Chunking of
long free-text is **deferred behind a `chunkText()` seam** (see Step 4) until the real data arrives.
- **Pros:** zero risk to `Products` or `seed.ts` (they never touch this collection); the vector
  index lives on a dedicated collection; re-embedding = wipe & refill one collection; matches the
  "VectorStore behind an adapter" rule so swapping Atlas → Pinecone/Qdrant later is one new adapter
  method + one env var. **This is the industry standard when you want to stay platform-agnostic** —
  the vectors are treated as a separate, replaceable index, not baked into your domain model.
- **Cons:** a join by `productId` after search (cheap — one `payload.find` with `productId in [...]`);
  two writes to keep roughly in sync (handled by re-running `npm run embed`).

### Option 2 — `embedding` field directly on `Products` (rejected)
```
products
  ...existing fields...
  embedding      (json / number[])   ← added
  embeddingText  (textarea)          ← added
```
- **Pros:** no join — search returns the product row directly; one collection.
- **Cons:** **bloats every product document** (a 768-float array on every row you `find`, unless you
  always remember `select`); **couples your catalog schema to one embedding provider's dimensions**
  (swap Gemini→OpenAI and the field shape/meaning changes across your domain model); harder to keep
  platform-agnostic because the vectors now live *inside* the thing you'd migrate; and while today's
  `seed.ts` safely *skips* existing `productId`s (so it won't erase vectors), any future
  product-update/re-import flow that passes a full `data:{}` would silently wipe the field.

---

## Seed / Payload conflict analysis (explicit concern)

- **`seed.ts` (products):** reads CSV → `payload.create` only for **new** `productId`s, **skips**
  existing (`existing.totalDocs > 0`). The generalized `embeddings` collection is separate, so
  `seed.ts` never references it — **no conflict, no overwrite**; the two are fully independent.
- **Re-seeding is safe:** running `npm run seed` again won't touch vectors. Running `npm run embed`
  again is **idempotent** — we upsert by `(sourceType, sourceId, chunkIndex)` (delete-then-insert),
  so re-running refreshes vectors without duplicating.
- **Ordering:** `embed` must run **after** `seed` (it reads products). We document this; the script
  fails loudly with a helpful message if the source collection is empty.
- **New Mongo collection:** like the chat collections, `embeddings` needs **no migration**
  (Mongo is schemaless) — it appears on dev-server restart, created on first write.
- **Atlas vector index:** the `$vectorSearch` index is created **once** in the Atlas UI (or via
  `createSearchIndex`) on `embeddings.vector` (plus `sourceType` as a filter field). Documented as a
  manual one-time setup step with exact JSON; it does not interfere with Payload's own Mongo indexes.

---

## New / changed files (map)

**New (core — no `payload`/SDK imports except where noted):**
```
src/lib/ai-chat/
  vector/
    VectorStore.ts            # INTERFACE: upsert(items) / similaritySearch(vector, limit) → ScoredChunk[]
    chunkText.ts              # SEAM: chunkText(text) → string[]; now returns [text] (1 chunk), later splits long text
  providers/
    resolveEmbeddingModel.ts  # EMBEDDING_PROVIDER/EMBEDDING_MODEL → AI SDK embedding model (google default)
  tools/
    searchKnowledgeBase.ts    # tool(): embed(query) → adapter.similaritySearch → rows (optional sourceType filter)
  retrieval/
    mode.ts                   # RetrievalMode type + resolveMode(reqOverride) with env fallback
```
**Changed (small, additive):**
```
src/lib/ai-chat/data/ChatDataAdapter.ts    # + upsertEmbeddings(), + similaritySearch()  (interface)
src/lib/ai-chat/data/payloadChatAdapter.ts # implement the two new methods (the ONLY payload-importing file)
src/lib/ai-chat/tools/index.ts             # buildTools(adapter, mode) — register tools per mode
src/lib/ai-chat/orchestrator.ts            # accept mode, pass to buildTools, stamp mode on saved messages
src/lib/ai-chat/index.ts                   # export new types/fns
src/lib/ai-chat/types.ts                   # + ScoredChunk, EmbeddingItem, RetrievalMode, SourceType
src/app/chat/route.ts                      # read optional body.mode, pass through to runChat
```
**New (host app):**
```
src/collections/chat/Embeddings.ts         # generalized vector collection (sourceType/sourceId/chunkIndex); register in payload.config.ts
src/seed/embed.ts                          # the standalone backfill script (mirrors seed.ts)
package.json                               # + "embed": "tsx src/seed/embed.ts" script (match seed's runner)
.env                                       # + EMBEDDING_PROVIDER, EMBEDDING_MODEL, RETRIEVAL_MODE
```
Reuse existing patterns: `resolveModel.ts` (mirror for embeddings), `queryProducts.ts` (mirror for
the tool), `seed.ts` (mirror for the backfill), `payloadChatAdapter.ts` (add methods, don't restructure).

---

## Build order — STOP GATES + manual commit messages

> At each 🛑 Claude summarizes the change, shows verification, prints the commit message, and STOPS
> until you say continue. Claude runs **no git commands**.

### Step 0 — Persist this plan in the repo
- Copy this plan to `.claude/plans/rag-phase-2-plan.md` (in-repo, committable) so the RAG plan lives
  beside `.claude/ai-chatbot-plan.md` for the team.
- **Verify:** the file exists in the repo under `.claude/plans/`.
- 🛑 **GATE 0**
  ```
  docs: add RAG phase 2 (Option B) implementation plan

  - add .claude/plans/rag-phase-2-plan.md: Gemini embeddings + Atlas $vectorSearch, db/rag/both retrieval modes, standalone backfill
  ```

### Step 1 — Dependency + embedding resolver (model-agnostic, mirrors `resolveModel`)
- `npm install` nothing new for Gemini embeddings (already have `@ai-sdk/google` + `ai`). Confirm
  `embed`/`embedMany` are available from `ai` v7.
- Add `providers/resolveEmbeddingModel.ts`: `EMBEDDING_PROVIDER` (default `google`) →
  `google.textEmbeddingModel(EMBEDDING_MODEL ?? 'gemini-embedding-001')`; branches for
  openai/others left as documented one-liners.
- Add env: `EMBEDDING_PROVIDER=google`, `EMBEDDING_MODEL=gemini-embedding-001`, `EMBEDDING_DIMS=768`.
- **Confirm batching:** a scratch script calls `embedMany` with, say, 250 dummy strings and logs how
  many API requests it makes / the effective `maxEmbeddingsPerCall`, so Step 4's batch size is set to
  stay within the per-request cap and the free-tier daily request budget.
- **Verify:** scratch script embeds "hello" and prints `vector.length` (== 768); embedMany of a small
  list returns one vector per input (proves `gemini-embedding-001` gives per-item, not aggregated, vectors).
- 🛑 **GATE 1**
  ```
  feat: add model-agnostic embedding resolver

  - add resolveEmbeddingModel() selecting embedding provider via EMBEDDING_PROVIDER env (default google/Gemini)
  - reuse existing @ai-sdk/google; no new dependency
  ```

### Step 2 — Generalized embeddings collection + Atlas index
- Add `src/collections/chat/Embeddings.ts` (`embeddings`, server-only access) with fields
  `sourceType, sourceId, chunkIndex, text, vector, metadata, model, dims`; register in
  `payload.config.ts`. Restart dev; confirm it appears in admin.
- Create the Atlas `$vectorSearch` index on `embeddings.vector` (document exact JSON:
  `numDimensions` = 768, `similarity: cosine`, plus `sourceType` declared as a filter field). One-time
  manual UI step.
- **Verify:** collection visible in admin; Atlas shows the search index as "Active".
- 🛑 **GATE 2**
  ```
  feat: add generalized embeddings collection for RAG vectors

  - add Embeddings collection (sourceType, sourceId, chunkIndex, text, vector, metadata, model, dims), server-only access
  - shape supports products now and blogs/pages/chunked text later without migration
  - register in payload.config.ts
  - document one-time Atlas $vectorSearch index setup (768 dims, cosine, sourceType filter)
  ```

### Step 3 — VectorStore interface + adapter methods
- Add `vector/VectorStore.ts` interface (`upsert`, `similaritySearch`) and `ScoredChunk`/`EmbeddingItem`/
  `SourceType` types in `types.ts`. `EmbeddingItem` carries `sourceType, sourceId, chunkIndex, text,
  vector, metadata`; `ScoredChunk` carries those back plus `score`.
- Extend `ChatDataAdapter` with `upsertEmbeddings(items)` and `similaritySearch(vector, limit, filter?)`
  (filter e.g. `{ sourceType }`); implement both in `payloadChatAdapter.ts` (`upsert` =
  delete-by-`(sourceType,sourceId,chunkIndex)` + create; `similaritySearch` = `payload.find`/aggregate
  with a `$vectorSearch` stage + optional `filter`, then map to `ScoredChunk`). Keep it the ONLY
  payload importer.
- **Verify:** scratch call to `adapter.upsertEmbeddings([...])` then `similaritySearch(vec,3)` returns
  scored rows (seed 2 rows by hand here, or after Step 4).
- 🛑 **GATE 3**
  ```
  feat: add VectorStore seam and Atlas-backed adapter methods

  - add VectorStore interface (upsert / similaritySearch with optional sourceType filter) and ScoredChunk type
  - extend ChatDataAdapter with upsertEmbeddings and similaritySearch
  - implement both in payloadChatAdapter via Atlas $vectorSearch (only payload-importing file)
  ```

### Step 4 — Backfill script (`npm run embed`) + chunk seam
- Add `vector/chunkText.ts`: `chunkText(text): string[]` — **now returns `[text]`** (one chunk).
  This is the deferred seam; when the prod DB brings long descriptions/blogs, this becomes overlapping
  ~400-token passages with no caller change.
- Add `src/seed/embed.ts` mirroring `seed.ts`: read all products, build one text blob per product
  (name | brand | category | rating | reviews), run each through `chunkText()` (→ 1 chunk now), tag
  each with `sourceType:'product'`, `sourceId:productId`, `chunkIndex`, and `metadata` (brand,
  category, rating, url) for filtering. `embedMany` (model `gemini-embedding-001`) in batches sized to
  the cap found in Step 1 (respect Gemini RPM — chunk + small delay), then `adapter.upsertEmbeddings(...)`.
  **Resume-safe:** skip sources that already have a current-model vector, so the catalog can be
  embedded across multiple runs/days without redoing work or blowing the daily cap. Idempotent
  by `(sourceType, sourceId, chunkIndex)`. Fail loudly if the source collection is empty.
  - **⚠️ Quota reality (CONFIRMED, corrects the earlier estimate):** `@ai-sdk/google` `embedMany`
    bundles ≤100 texts per `batchEmbedContents` HTTP call, BUT the free-tier quota
    `EmbedContentRequestsPerMinutePerUserPerProjectPerModel = 100` counts **each embedded item**, not
    each HTTP call (empirically: `embedMany(250)` → HTTP 429). Free-tier embedding limits are
    **100/min · 30K TPM · 1,000/day**.
  - **Consequence:** ~7,500 products **cannot** be embedded in a single free-tier day (1,000/day cap),
    and even the daily 1,000 must be throttled to ≤100/min.
  - **Backfill design:** throttle to ≤~90/min (batches of ≤90 with a ~60s pause), and honor an
    `EMBED_LIMIT` env (default e.g. 900/run to stay under the daily cap). Resume-safe skip means each
    day's run tops up where the last left off. For the demo, embed a **representative subset**
    (e.g. 500–900 products, or one category) — finishes in one free day, plenty to show RAG vs DB A/B.
    Full 7,500 = spread over ~8 days, or use a paid/prod key for a one-shot backfill.
- Add `"embed"` script to `package.json`. (Blog/page source types are added here later by reading
  those collections into the same pipeline — no schema change.)
- **Verify:** `npm run embed` reports "embedded N / N"; `embeddings` count (sourceType=product) ==
  products count.
- 🛑 **GATE 4**
  ```
  feat: add embedding backfill script and chunk seam

  - add chunkText() seam (single chunk now; splits long text later without caller changes)
  - add npm run embed: reads products, embeds a synthesized blob per product with Gemini (batched), tags sourceType/metadata, upserts vectors
  - idempotent + resume-safe by (sourceType, sourceId, chunkIndex); safe to re-run after re-seeding
  ```

### Step 5 — `searchKnowledgeBase` tool + retrieval mode wiring
- Add `retrieval/mode.ts`: `RetrievalMode = 'db' | 'rag' | 'both'`; `resolveMode(override?)` =
  override ?? `process.env.RETRIEVAL_MODE` ?? `'db'`.
- Add `tools/searchKnowledgeBase.ts` mirroring `queryProducts`: embed the query, call
  `adapter.similaritySearch` (optional `sourceType` filter exposed as a tool arg), return scored rows.
- Change `buildTools(adapter, mode)`: `db`→`{queryProducts}`, `rag`→`{searchKnowledgeBase}`,
  `both`→both.
- Change `runChat` to accept `mode` and pass it in; stamp the mode into the saved assistant message
  (extend `guardrailFlags`/a new `retrievalMode` on `NewMessage`) for A/B auditability.
- Change `src/app/chat/route.ts` to read optional `body.mode` and forward it.
- Update `seedPrompt.ts` system prompt so it mentions *either* tool generically ("use the available
  product-search tool") so one prompt works across all three modes.
- **Verify:** `runChat({...,}, adapter)` with `mode:'rag'` answers a fuzzy question from semantic
  matches; `mode:'db'` still uses filters; `mode:'both'` exposes both. `chat-messages` rows show the
  stamped mode.
- 🛑 **GATE 5**
  ```
  feat: add RAG search tool and db/rag/both retrieval modes

  - add searchKnowledgeBase tool (embed query -> Atlas similaritySearch -> grounded rows)
  - add retrieval mode resolver (RETRIEVAL_MODE env + per-request override)
  - buildTools(adapter, mode) registers tools per mode; runChat stamps mode on messages
  - forward optional body.mode through POST /chat
  ```

### Step 6 — A/B demo + docs
- Extend the widget (or a tiny scratch page / curl snippets) to send `mode` so you can flip arms
  live in front of the mentor.
- Add a short `RAG A/B` section to `src/lib/ai-chat/README.md`: how to run `embed`, how to switch
  modes, how to read the stamped mode in `chat-messages`, and the honest limitation (catalog has no
  review free-text yet, so RAG's edge is limited until the prod-DB copy with richer text lands).
- **Verify:** same question under `db` vs `rag` returns visibly different retrieval; results logged.
- 🛑 **GATE 6**
  ```
  docs: enable RAG A/B demo and document retrieval modes

  - allow widget/curl to select retrieval mode for side-by-side A/B
  - document embed backfill, mode switching, and message-level mode logging in ai-chat README
  ```

---

## Verification (end-to-end)
1. `npm run seed` (if needed) → `npm run embed` → `embeddings` (sourceType=product) populated 1:1 with products.
2. Atlas index "Active".
3. `curl -X POST localhost:3000/chat -d '{"sessionKey":"t1","message":"something gentle for sensitive skin","mode":"rag"}'`
   → answer grounded in semantic matches; `chat-messages` shows `searchKnowledgeBase` in `toolResults` + mode.
4. Same message with `"mode":"db"` → uses `queryProducts` filters instead (likely weaker on this fuzzy query — that's the A/B point).
5. `"mode":"both"` → model has both tools.
6. Swap test: set `EMBEDDING_PROVIDER`/`AI_PROVIDER` and confirm nothing else changes (agnostic seams hold).
7. Re-run `npm run embed` → counts stay 1:1 (idempotent by `(sourceType,sourceId,chunkIndex)`), no duplicates.

## Decisions locked (via clarification)
- **Storage:** generalized `embeddings` collection (`sourceType/sourceId/chunkIndex`), not a field on Products, and not products-only — ready for the incoming CMS blogs/pages.
- **Arm control:** `RETRIEVAL_MODE` env default + per-request `mode` override.
- **Backfill:** standalone resume-safe `npm run embed` with `gemini-embedding-001` (free tier), one embedding per product now.
- **Chunking:** deferred behind the `chunkText()` seam; turned on for long text when the prod DB lands.

## Prod-copy DB findings + source decision (added after inspecting the mentor's DB)
- The prod copy is a **full Payload CMS site** (Luxskin clinic; DB `luxskin_chatbot_staging`), NOT the
  products catalog. Content collections: `treatments` (7), `posts` (6), `testimonials` (3),
  `concerns` (5), `treatment-categories`/`categories`, `authors`, `video-testimonials`, `pages`,
  plus a Payload `searches` index. ~40 content docs total → **RAG-ideal and far under the 1,000/day
  embedding cap** (the quota worry only applied to the 7,500 dummy products).
- **Gotcha:** `treatments`/`posts` (the richest text) use Payload **drafts + versions + Lexical
  rich-text** — real body lives in `_treatments_versions` / `_posts_versions`. Reading them correctly
  means resolving published versions and flattening Lexical (Payload does this automatically; raw
  Mongo does not). Flat collections (`testimonials`, `concerns`, categories, `authors`) are easy.
- **Access:** only the **DB copy** is available (no Luxskin codebase) → use **Approach B**
  (read-only source adapter from this repo via raw Mongo, `SOURCE_DATABASE_URI`), NOT repointing the
  app's `DATABASE_URL`.
- **Sequencing decision (updated):** the Luxskin prod-DB testing will happen in a **SEPARATE new
  Payload project** the user will wire up — **not** in this repo. This repo stays on the **dummy
  products** database and its job now is to **build the AI code end-to-end and keep it maximally
  model-/DB-/CMS-agnostic**, so it can be **copied** into the Luxskin project with minimal changes.
  Therefore there is **no in-repo source swap** (the earlier "Step 7 swap" is replaced by the
  portability contract below). `src/seed/inspectSource.ts` remains as a handy read-only explorer.

### Portability contract (what makes the copy-paste to the new project work)
- **Copies untouched:** everything in `src/lib/ai-chat/` that imports no `payload`/DB/SDK —
  orchestrator, guardrails, prompts, `retrieval/mode.ts`, `providers/resolveModel.ts` +
  `resolveEmbeddingModel.ts`, `vector/VectorStore.ts` + `chunkText.ts`, `tools/index.ts`, `types.ts`,
  `index.ts`.
- **Re-authored per project (the intentional seam):** the `ChatDataAdapter` implementation
  (`payloadChatAdapter.ts`), the chat + `embeddings` collection configs, the domain-shaped query tool
  and embedding text-blob (products vs. treatments/Lexical), and env/route/widget/Atlas-index config.
- **Hard rule that keeps the promise true:** NOTHING imports `payload`, a DB driver, or a provider SDK
  outside the adapter files and the two resolvers. Enforce on every step; `tsc` catches most leaks.
- In the Luxskin project specifically, the adapter/ingestion must **resolve published `_versions` +
  flatten Lexical** for `treatments`/`posts`; flat collections (`testimonials`, `concerns`, categories,
  `authors`) map directly. Emit into the generalized `embeddings` store with `sourceType ∈ {treatment,
  post, testimonial, concern, category, author, page}` — no RAG-core changes needed.
