# ai-chat

A model-, DB-, and platform-agnostic chatbot core. Answers questions about the
product catalog and grounds every reply in real data. It has **two retrieval
paths**: exact **database filters** (`queryProducts`) and semantic **RAG**
(`searchKnowledgeBase` — Gemini embeddings + MongoDB Atlas `$vectorSearch`). A
per-request **retrieval mode** picks which arm(s) the model may use, so you can
A/B the two. The final answer can also come back as a **typed, shape-tagged object**
(timeline / product list / comparison / plain) the frontend renders as a real
component — see [STRUCTURED-OUTPUT.md](./STRUCTURED-OUTPUT.md) for the design and the
options we weighed. See [PORTING.md](./PORTING.md) for moving this core into another repo.

## How it fits together

```
runChat(input, adapter)        <- the one entry point (orchestrator.ts)
  ├─ providers/resolveModel    <- which LLM (AI_PROVIDER env; default Gemini Flash)
  ├─ guardrails/               <- input checks (rate limit, off-topic, injection)
  │                               + output transforms (PII redaction, length cap)
  ├─ retrieval/resolveMode     <- picks the arm: db | rag | both (env + per-request)
  ├─ tools/buildTools(mode)    <- registers queryProducts and/or searchKnowledgeBase
  │    ├─ queryProducts        <- exact DB filters (brand/category/rating)
  │    └─ searchKnowledgeBase  <- embed(query) -> Atlas $vectorSearch -> nearest rows
  ├─ providers/resolveEmbeddingModel <- which embedding model (EMBEDDING_* env)
  ├─ prompts/render            <- {{placeholder}} substitution for system prompts
  └─ data/ChatDataAdapter      <- the ONLY seam that touches storage (+ VectorStore)
       └─ payloadChatAdapter   <- the ONLY file that imports `payload`
```

**Golden rule:** nothing here imports `payload`, a DB driver, or a provider SDK —
except `data/payloadChatAdapter.ts` and `providers/resolveModel.ts`. That rule is
what keeps the core swappable and lets it be lifted into a shared package later.

## Usage

```ts
import { getPayload } from 'payload'
import config from '@/payload.config'
import { runChat, createPayloadChatAdapter } from '@/lib/ai-chat'

const payload = await getPayload({ config })
const adapter = createPayloadChatAdapter(payload)
const { text } = await runChat(
  { sessionKey, message, templateKey: 'product-assistant' },
  adapter,
)
```

Over HTTP this is wrapped by `POST /chat` (`src/app/chat/route.ts`), consumed by
`ChatWidget` (`src/app/(frontend)/components/ChatWidget.tsx`).

## Configuration (env)

| Var | Purpose | Default |
| --- | --- | --- |
| `AI_PROVIDER` | `google` \| `anthropic` \| `openai` | `google` |
| `AI_MODEL` | override the model id | provider default |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini key (free tier) | — |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | only if swapping provider | — |
| `RETRIEVAL_MODE` | default arm: `db` \| `rag` \| `both` | `db` |
| `EMBEDDING_PROVIDER` | embedding provider | `google` |
| `EMBEDDING_MODEL` | embedding model id | `gemini-embedding-001` |
| `EMBEDDING_DIMS` | vector dimensions (must match the Atlas index) | `768` |
| `VECTOR_INDEX_NAME` | Atlas `$vectorSearch` index name | `vector_index` |
| `EMBED_BATCH` / `EMBED_RPM_DELAY_MS` / `EMBED_LIMIT` | backfill knobs (see below) | `90` / `60000` / `∞` |

## Storage (Payload collections)

- `prompt-templates` — content-managed system prompts, looked up by `key`.
- `chat-sessions` — one per conversation (`sessionKey` from the client).
- `chat-messages` — turns, with tool calls/results, token usage, and the
  `retrievalMode` that produced each turn (the A/B audit label).
- `embeddings` — generalized vector store (`sourceType/sourceId/chunkIndex/vector/
  metadata`). Backed by an Atlas `$vectorSearch` index; only touched by
  `npm run embed` and `searchKnowledgeBase`.

## RAG A/B (db vs rag vs both)

**1. Backfill the vectors** (offline, idempotent, resume-safe — re-run after
re-seeding products):

```
npm run seed        # products must exist first
npm run embed       # embeds one blob per product into `embeddings`
```

Requires a one-time Atlas `$vectorSearch` index on `embeddings.vector`
(768 dims, cosine, with `sourceType` as a filter field), named to match
`VECTOR_INDEX_NAME`. Fresh inserts take ~7–9s to become searchable (index lag).
Gemini free tier caps embedding at **1,000 items/day**, so a very large catalog
must span multiple days (the script skips already-embedded sources) or use a
paid key.

**2. Switch arms.** Set the global default with `RETRIEVAL_MODE`, or override
per request with `body.mode`. The widget exposes a **db / rag / both** toggle;
via curl:

```
curl -X POST localhost:3000/chat -H 'content-type: application/json' \
  -d '{"sessionKey":"t1","message":"something gentle for sensitive skin","mode":"rag"}'
```

- `db` — only `queryProducts` (exact filters). Strong on "Cerave, rating ≥ 4".
- `rag` — only `searchKnowledgeBase` (semantic). Strong on fuzzy/need-based text.
- `both` — model has both tools and chooses per question.

**3. Audit the result.** Every turn stamps `retrievalMode` on its `chat-messages`
row (indexed), alongside `toolCalls`/`toolResults`. Run the same question under
`db` then `rag` and compare the tools fired and the rows returned.

> **Honest limitation:** the dummy catalog has only name/brand/category/rating —
> no review or description free-text — so RAG's semantic edge is modest here. Its
> advantage grows once the prod DB (richer descriptions, blogs, pages) lands; the
> `sourceType`/`chunkIndex` shape already absorbs that with no migration.

## Smoke tests (manual, need a live DB + API key)

```
npm run ai:smoke        # provider resolver (swap AI_PROVIDER to prove agnosticism)
npm run ai:smoke:tool   # queryProducts tool-calling against real data
npm run ai:smoke:chat   # full runChat() end-to-end, incl. persistence + guardrails
npm run seed:prompt     # (re)seed the default product-assistant prompt
```

Guardrail unit tests: `npm run test:int` (see `tests/int/guardrails.int.spec.ts`).

## Extending

- **New tool** — add it under `tools/`, register in `tools/index.ts`. The
  orchestrator is unchanged.
- **New provider** — add a case in `providers/resolveModel.ts`.
- **New backend / DB** — implement `ChatDataAdapter` (incl. the `VectorStore`
  methods) against it; nothing else moves.
- **New embedding provider** — add a case in `providers/resolveEmbeddingModel.ts`.
- **New vector store** (Pinecone/Qdrant…) — reimplement `upsertEmbeddings` /
  `similaritySearch` in a new adapter; the `VectorStore` interface is the seam.
- **New source type** (blogs/pages) — read that collection into `src/seed/embed.ts`
  tagged with its `sourceType`; no schema change. See [PORTING.md](./PORTING.md).
