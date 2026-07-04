# AI Chatbot for Payload — Phase 1: Database-Querying (RAG-ready, model/DB/platform agnostic)

## Context

**Why we're building this.** We want a reusable chatbot we can drop into any client site we build. For the current demo it must answer questions about our beauty-product catalog by **querying the database** and letting an LLM phrase the answer from real rows — full RAG (embeddings/semantic search) comes later. The hard requirement is that this be built *without spaghetti*: model-agnostic (swap LLMs via env var), DB-agnostic (we just moved to Mongo Atlas and it must not matter to the chatbot code), and platform-agnostic (the core logic can be lifted into a shared npm package and reused across client projects). This plan gets database-querying working first while leaving clean seams for RAG.

**Current repo state (verified by reading the files).**
- Payload **3.85.2**, Next.js **16.2.6**, React 19. Package manager is **npm** (per CLAUDE.md), not pnpm.
- **DB is already MongoDB Atlas**: [src/payload.config.ts](src/payload.config.ts) uses `mongooseAdapter` from `@payloadcms/db-mongodb`. No SQLite remains. Mongo is schema-less, so **there is no migration-file step** — new collections take effect on dev-server restart and their Mongo collections are created on first write.
- Collections: `Users` (auth), `Media`, `Products`. [src/collections/Products.ts](src/collections/Products.ts) is a rich catalog with **indexed** `productId`, `brandName`, `defaultCategory`; plus `categories` (hasMany text), text pricing, and numeric ratings/engagement fields. `read: () => true` (public).
- [src/seed/seed.ts](src/seed/seed.ts) already reads/writes through Payload's **Local API** (`payload.find` / `payload.create`) — this is the same API our chatbot will use, and it's identical regardless of DB adapter. **This is why the whole thing is DB-agnostic for free.**
- Routing: `src/app/(frontend)/` (public site) and `src/app/(payload)/` (admin + Payload's `/api/*` catch-all at `(payload)/api/[...slug]/route.ts`). [src/app/my-route/route.ts](src/app/my-route/route.ts) is an example custom route using `getPayload({ config })` — the pattern we'll mirror.
- **No AI SDKs installed** — greenfield feature.

## Scope of THIS phase (read this so expectations are clear)

- ✅ **In scope now:** a chatbot that, when asked about products, **looks up real rows in our database and answers from them.**
- ❌ **Not in scope now: RAG.** We will **only document** how RAG would slot in later (§7). We are not installing a vector database, not generating embeddings, not writing any RAG code in this phase. If you find yourself adding an embedding or a vector store, stop — that's the next phase.

## AI concepts you need first (never worked with AI? start here)

Plain-English definitions for every AI term used below. Read once; the rest of the plan will make sense.

- **LLM (Large Language Model)** — the "brain", e.g. Google's *Gemini Flash*. It's a program you send text to and it sends text back. It's good at language (phrasing, summarizing, answering) but it does **not** know our product data and it sometimes **makes things up** ("hallucinates"). That's the whole reason for the next point.
- **Grounding** — the trick that stops the model making things up: instead of asking the LLM "what's a good moisturizer?" from memory, we **first fetch the real answer from our database**, then hand those rows to the LLM and say "answer *using only this data*." The DB provides the facts; the LLM only does the wording. For us, "grounding" = database query results. (RAG is just a *different* way to fetch grounding facts — semantic search instead of exact filters — which is why it's a later phase, not a different product.)
- **Prompt** — the text we send the LLM. Two kinds matter here:
  - **System prompt** — standing instructions that set the bot's role/tone/rules ("You are a beauty-product assistant. Only answer from provided data. Be concise."). We store these in the DB so non-engineers can edit them (§2, `PromptTemplates`).
  - **User message** — what the visitor typed.
- **Tool / tool-calling** — the modern way to "let the LLM query the database." We *describe* a function to the model (e.g. `queryProducts(brand, category, minRating)`). The model can't run code, but it can **decide** "to answer this, I should call `queryProducts` with brand='X'." Our code runs the actual `payload.find(...)`, returns the rows to the model, and the model writes the final sentence. This is how DB-query grounding works without RAG. The model picks *when* to call and *what* filters to use — we just supply the function.
- **Context / chat history** — LLMs are stateless (they forget between calls). To make a conversation feel continuous, we resend the last few messages each time. We store them (§2, `Messages`) and pass the recent ones back in.
- **Tokens** — how LLMs count text (roughly ¾ of a word each). You pay per token and there's a max per call, so we keep prompts lean (e.g. only fetch the product fields we need). Gemini Flash's free tier is generous enough for the demo.
- **Guardrails** — safety checks *around* the LLM that the LLM itself won't reliably do: block off-topic/abusive input, redact personal info, rate-limit spammers. We run these before and after the model call (§3).
- **Provider / model-agnostic** — "provider" = the company whose LLM we use (Google, Anthropic, OpenAI). "Model-agnostic" = we wrote our code so switching providers is a one-line env-var change, not a rewrite. The **Vercel AI SDK** (the `ai` package) is the translator that gives every provider the same interface.
- **Vercel AI SDK (`ai`)** — a small library that gives us one uniform way to (a) call any provider's LLM and (b) do tool-calling. It's not itself an AI; it's the universal remote.

## The one idea that prevents spaghetti

The chatbot is **four independent pieces** connected by **one orchestrator function**, and everything talks through **interfaces**, not concrete SDKs/DBs:

| Piece | Job | Agnostic seam |
|---|---|---|
| **Provider** | which LLM answers | `resolveModel()` reads `AI_PROVIDER` → returns a Vercel AI SDK model. Business code never imports a provider SDK. |
| **Tools** | how the LLM gets facts | `queryProducts` tool → calls the adapter, not `payload` directly. |
| **Guardrails** | what's allowed in/out | small pure functions in a pipeline, not scattered `if`s. |
| **Storage/Data** | sessions, messages, prompts, product lookups | a single `ChatDataAdapter` interface. **Only its implementation touches `payload`.** |

Rule of thumb, stated once and enforced everywhere: **nothing under `src/lib/ai-chat/` imports `payload`, `getPayload`, a DB driver, or a provider SDK — except the two adapter files and the provider resolver.** That single rule is what makes the core liftable into `@ourorg/ai-chat` later: a new client project reimplements the adapter against *its* collections and reuses the rest unchanged.

## 1. Dependencies

```
npm install ai @ai-sdk/google @ai-sdk/anthropic @ai-sdk/openai zod
```

- **`ai`** — Vercel AI SDK core: `generateText` / `streamText` + `tool()` for tool-calling. This is the model-agnostic layer.
- **`@ai-sdk/google`** — **default provider: Gemini Flash free tier** (`gemini-2.0-flash`), keyed by `GOOGLE_GENERATIVE_AI_API_KEY`.
- **`@ai-sdk/anthropic`, `@ai-sdk/openai`** — installed now (not used by default) so "swap provider" is a one-line env change and is proven from day one, not a future refactor.
- **`zod`** — tool parameter schemas (AI SDK requires them) and guardrail validation.

Env vars: `AI_PROVIDER=google` (default), `AI_MODEL` (optional override), `GOOGLE_GENERATIVE_AI_API_KEY`, and later `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` when swapping.

No vector DB yet — see §7.

## 2. New Payload collections (`src/collections/chat/`)

Add to `collections: [...]` in [src/payload.config.ts](src/payload.config.ts). No migration files (Mongo). Keep field shapes deliberately generic so these collections are copy-pasteable into other client projects.

**`PromptTemplates.ts`** (`prompt-templates`) — system prompts as content, so non-engineers edit tone/rules without a deploy, and we get version history in the admin UI:
- `key` (text, unique, index) — looked up by key (e.g. `product-assistant`), not by ID.
- `label` (text), `systemPrompt` (textarea, required; documents `{{placeholders}}` in `admin.description`), `version` (number, default 1), `isActive` (checkbox, default true), `notes` (textarea changelog).
- Access: admin-only (`read/create/update: ({ req }) => Boolean(req.user)`). Not public — the server reads it via Local API.

**`ChatSessions.ts`** (`chat-sessions`) — one row per widget conversation:
- `sessionKey` (text, unique, index) — opaque client-generated UUID (localStorage), **not** a Payload user, since the widget is unauthenticated.
- `promptTemplateKey` (text) — pins the session to a template so later edits don't rewrite old history.
- `status` (select: active/archived/blocked) — a guardrail can flip to `blocked` after repeated abuse.
- `metadata` (json) — free-form; a `clientId`/`tenantId` here is the seam if one deployment ever serves multiple client sites.
- Access: server-only (no public read/write; touched exclusively through the adapter).

**`Messages.ts`** (`chat-messages`):
- `session` (relationship → `chat-sessions`, required, index), `role` (select: user/assistant/tool/system), `content` (textarea).
- `toolCalls` / `toolResults` (json) — which tool ran + args + returned rows, so every answer is traceable to real data (answers "why did it say that").
- `guardrailFlags` (json), `tokenUsage` (json) — audit trail + cost tracking.
- Access: server-only.

## 3. The reusable core (`src/lib/ai-chat/`)

```
src/lib/ai-chat/
  index.ts                     # public surface = the future package boundary
  types.ts                     # ChatMessage, GuardrailResult, ProductQueryArgs, records...
  providers/
    resolveModel.ts            # reads AI_PROVIDER -> AI SDK model (google | anthropic | openai)
  data/
    ChatDataAdapter.ts         # INTERFACE (no payload import)
    payloadChatAdapter.ts      # implementation (the ONLY file importing payload)
  tools/
    queryProducts.ts           # zod schema + execute() -> adapter.queryProducts()
    index.ts                   # tool registry (buildTools(adapter))
  guardrails/
    inputRules.ts              # rate limit, off-topic, prompt-injection heuristic
    outputRules.ts             # PII redaction, length/format
    index.ts                   # runInputGuardrails() / runOutputGuardrails() pipelines
  prompts/
    render.ts                  # pure {{placeholder}} substitution
  orchestrator.ts              # runChat(input, adapter) -- wires it all together
```

**`data/ChatDataAdapter.ts`** — the decoupling seam. Pure interface, no Payload import:
```ts
export interface ChatDataAdapter {
  getOrCreateSession(sessionKey: string, templateKey: string): Promise<SessionRecord>
  getRecentMessages(sessionId: string, limit: number): Promise<MessageRecord[]>
  saveMessage(msg: NewMessage): Promise<void>
  getActivePromptTemplate(key: string): Promise<{ systemPrompt: string; version: number } | null>
  queryProducts(args: ProductQueryArgs): Promise<ProductSummary[]>
}
```
**`data/payloadChatAdapter.ts`** implements it with `payload.find` / `payload.create`. `queryProducts` maps NL-derived args → a Payload `where` clause using the operators in [QUERIES.md](.claude/skills/payload/reference/QUERIES.md) against the **indexed** fields:
```ts
// e.g. { brandName: { contains }, defaultCategory: { equals }, averageRating: { greater_than_equal } }
payload.find({ collection: 'products', where, limit: Math.min(args.limit ?? 5, 10), sort: '-averageRating',
  select: { productName: true, brandName: true, defaultCategory: true, priceRange: true, averageRating: true, totalReviews: true, url: true } })
```
`select` keeps token usage/cost down by returning only fields the model needs. **DB-agnostic:** because this only calls the Local API, the Mongo→(anything) question never reaches the chatbot; it's a `payload.config.ts` concern.

**`providers/resolveModel.ts`** — model-agnostic swap:
```ts
export const resolveModel = () => {
  switch (process.env.AI_PROVIDER ?? 'google') {
    case 'anthropic': return anthropic(process.env.AI_MODEL ?? 'claude-sonnet-4-5')
    case 'openai':    return openai(process.env.AI_MODEL ?? 'gpt-4o-mini')
    default:          return google(process.env.AI_MODEL ?? 'gemini-2.0-flash')
  }
}
```

**`tools/queryProducts.ts`** — the "chat with your DB, no RAG" mechanism. The LLM decides *when* to call it and *what* filters to use:
```ts
export const buildQueryProducts = (adapter: ChatDataAdapter) => tool({
  description: 'Search the beauty-product catalog by name, brand, or category; optionally filter by minimum rating.',
  parameters: z.object({
    search: z.string().optional(), brandName: z.string().optional(),
    category: z.string().optional(), minRating: z.number().optional(),
    limit: z.number().max(10).default(5),
  }),
  execute: (args) => adapter.queryProducts(args),
})
```

**`guardrails/`** — composable pipeline, each rule `(ctx) => GuardrailResult`, independently unit-testable and reusable per-client (a client can add "no medical advice" without touching the rest). Demo scope, with honest limitations noted in code:
- Off-topic: cheap yes/no classification (same model, tiny prompt) or keyword allowlist.
- PII redaction: regex for email/phone/card patterns — on input before persisting and on output before returning.
- Rate limit per `sessionKey`: in-memory sliding window for the demo (**limitation: won't survive restart / multi-instance — swap for Redis or a DB counter in production**; note it in a comment).
- Prompt-injection: heuristic reject of "ignore previous instructions"-style input (not bulletproof — labeled as such).

**`orchestrator.ts`** — the only function callers touch. Adapter is dependency-injected:
```ts
export async function runChat(input: { sessionKey, message, templateKey }, adapter: ChatDataAdapter) {
  const session = await adapter.getOrCreateSession(input.sessionKey, input.templateKey)
  const gate = await runInputGuardrails({ message: input.message, session })
  if (!gate.allowed) return blocked(gate)

  const [template, history] = await Promise.all([
    adapter.getActivePromptTemplate(input.templateKey),
    adapter.getRecentMessages(session.id, 10),
  ])
  const result = await generateText({
    model: resolveModel(),
    system: renderTemplate(template.systemPrompt, { /* vars */ }),
    messages: [...toModelMessages(history), { role: 'user', content: input.message }],
    tools: buildTools(adapter),
    maxSteps: 3, // allow the model: call tool -> read rows -> answer
  })
  const outGate = await runOutputGuardrails({ text: result.text, session })
  const finalText = outGate.allowed ? result.text : (outGate.sanitized ?? FALLBACK)

  await adapter.saveMessage({ session: session.id, role: 'user', content: input.message })
  await adapter.saveMessage({ session: session.id, role: 'assistant', content: finalText,
    toolCalls: result.toolCalls, toolResults: result.toolResults, tokenUsage: result.usage })
  return { text: finalText, sessionKey: session.sessionKey }
}
```
A `streamChat()` twin (using `streamText`, guardrails + persistence in `onFinish`) can be added later for nicer UX without changing this shape.

## 4. HTTP endpoint

Use a **Next.js route handler** mirroring the existing [src/app/my-route/route.ts](src/app/my-route/route.ts) pattern (`getPayload({ config })`). Place it **outside `/api/`** to avoid colliding with Payload's `(payload)/api/[...slug]` catch-all — e.g. `src/app/chat/route.ts` → `POST /chat` (same top-level style as `my-route`). Streaming is also easiest here (`result.toDataStreamResponse()`), which is why a route handler is preferred over a Payload collection endpoint for this.

```ts
// src/app/chat/route.ts
import configPromise from '@payload-config'
import { getPayload } from 'payload'
import { runChat } from '@/lib/ai-chat'
import { createPayloadChatAdapter } from '@/lib/ai-chat/data/payloadChatAdapter'

export const POST = async (req: Request) => {
  const payload = await getPayload({ config: configPromise })
  const { sessionKey, message } = await req.json()
  const adapter = createPayloadChatAdapter(payload)
  const result = await runChat({ sessionKey, message, templateKey: 'product-assistant' }, adapter)
  return Response.json(result)
}
```
(Alternative, if we later want it namespaced under Payload's own API surface: register on `payload.config.ts`'s `endpoints` array — collection/global scoped per [ENDPOINTS.md](.claude/skills/payload/reference/ENDPOINTS.md). Not preferred here because of the catch-all and streaming ergonomics.)

## 5. Frontend widget (minimal, demo scope)

`src/app/(frontend)/components/ChatWidget.tsx` — a small floating chat box: generate/persist `sessionKey` via `crypto.randomUUID()` in localStorage, POST `{ sessionKey, message }` to `/chat`, render the reply. **No business logic in the widget** — it depends only on the HTTP contract, so it drops into any client frontend unchanged. (Optional: `@ai-sdk/react`'s `useChat` if/when we stream.)

## 6. Build order — with STOP GATES for review + commit

**How the gates work — GIT IS 100% MANUAL, CLAUDE NEVER COMMITS.** The user commits from a separate terminal. At every 🛑, Claude will (a) summarize what changed, (b) run/show the verification, (c) **print a ready-to-paste conventional-commit message** (subject + point-form body) for the user to run themselves, then (d) **STOP and wait** for "continue"/"go". Claude must **not** run `git add`, `git commit`, `git push`, or any git command, and must not advance past a gate on its own — even if asked to "keep going" without an explicit continue at that gate.

- **Step 0 — persist the plan.** Copy this plan to `d:\Amzal Projects\aesth-ai\.claude\ai-chatbot-plan.md` (in-repo, committable) and install deps from §1 (`npm install ...`).
  *Verify:* plan file exists in repo; `package.json` shows `ai`, `@ai-sdk/*`, `zod`.
  🛑 **GATE 0** — suggested commit message:
  ```
  chore: add AI chatbot plan and dependencies

  - add in-repo implementation plan at .claude/ai-chatbot-plan.md
  - install ai, @ai-sdk/google, @ai-sdk/anthropic, @ai-sdk/openai, zod
  ```
  → *user commits manually, then says continue*

- **Step 1 — Collections.** Add `PromptTemplates`, `ChatSessions`, `Messages` under `src/collections/chat/`, register in [src/payload.config.ts](src/payload.config.ts), restart dev, seed one active `product-assistant` prompt template.
  *Verify:* collections appear in admin; the seeded template is visible.
  🛑 **GATE 1** — suggested commit message:
  ```
  feat: add chat collections (prompt templates, sessions, messages)

  - add PromptTemplates collection (content-managed system prompts, keyed + versioned)
  - add ChatSessions and Messages collections for conversation storage
  - register collections in payload.config.ts
  - seed initial product-assistant prompt template
  ```
  → *user commits manually, then says continue*

- **Step 2 — Provider.** `providers/resolveModel.ts` + env vars; smoke-test `generateText` on Gemini, then flip `AI_PROVIDER` to prove the swap.
  *Verify:* text comes back from two providers with no code change.
  🛑 **GATE 2** — suggested commit message:
  ```
  feat: add model-agnostic LLM provider resolver

  - add resolveModel() selecting provider via AI_PROVIDER env (default google/Gemini Flash)
  - wire Vercel AI SDK with google, anthropic, and openai providers
  ```
  → *user commits manually, then says continue*

- **Step 3 — Data adapter + `queryProducts` tool.** `ChatDataAdapter` interface, `payloadChatAdapter`, and the tool; test tool-calling in isolation.
  *Verify:* asking "products by <real brand>" triggers the tool and returns real rows.
  🛑 **GATE 3** — suggested commit message:
  ```
  feat: add product query tool and Payload data adapter

  - add ChatDataAdapter interface (DB-agnostic seam, no payload import)
  - add payloadChatAdapter backed by Payload Local API
  - add queryProducts tool for LLM tool-calling over the products collection
  ```
  → *user commits manually, then says continue*

- **Step 4 — Guardrails.** Pure functions in `guardrails/`, unit-tested standalone.
  *Verify:* off-topic / injection / PII inputs are handled by the unit tests.
  🛑 **GATE 4** — suggested commit message:
  ```
  feat: add input and output guardrail pipelines

  - add input guardrails: rate limiting, off-topic filter, prompt-injection heuristic
  - add output guardrails: PII redaction, length/format checks
  - add unit tests for each rule
  ```
  → *user commits manually, then says continue*

- **Step 5 — Orchestrator.** Wire steps 1–4; call `runChat()` directly (no HTTP).
  *Verify:* a real question yields a grounded answer; `chat-sessions`/`chat-messages` rows appear; follow-up keeps context.
  🛑 **GATE 5** — suggested commit message:
  ```
  feat: add chat orchestrator wiring provider, tools, guardrails, storage

  - add runChat() orchestrating guardrails, prompt template, history, tool-calling, persistence
  - add prompt template rendering and message-history mapping
  ```
  → *user commits manually, then says continue*

- **Step 6 — Endpoint.** `src/app/chat/route.ts`; test with curl.
  *Verify:* curl returns JSON; guardrails block bad input over HTTP.
  🛑 **GATE 6** — suggested commit message:
  ```
  feat: add POST /chat endpoint for the chatbot

  - add Next.js route handler calling runChat via the Payload adapter
  - return grounded JSON responses; guardrails enforced over HTTP
  ```
  → *user commits manually, then says continue*

- **Step 7 — Widget.** `ChatWidget.tsx`; end-to-end against real product data.
  *Verify:* multi-turn conversation in the browser, history persists, answers grounded.
  🛑 **GATE 7** — suggested commit message:
  ```
  feat: add frontend chat widget

  - add ChatWidget with localStorage sessionKey and POST /chat integration
  - verify multi-turn grounded conversation end-to-end
  ```
  → *done*

## 7. Future RAG — DOCUMENTATION ONLY (do not build in this phase)

**This section is written down so the design leaves room for RAG — we are NOT implementing any of it now.** No packages, no embeddings, no vector store in this phase. Ship DB-query grounding first (§1–6), then come back to this.

*Intern note — what RAG even is:* everything above grounds answers with **exact database filters** (brand = X, rating ≥ 4). That works great for structured questions ("show me highly-rated products by brand X"). It fails for fuzzy/meaning-based questions over free text ("which products do reviewers say are gentle on sensitive skin?") because there's no clean field to filter on. **RAG (Retrieval-Augmented Generation)** solves that by turning text into **embeddings** (lists of numbers capturing meaning), storing them in a **vector store**, and finding the closest matches to the user's question by meaning rather than exact words — then grounding the LLM on those matches. Same grounding idea as §"AI concepts", just a smarter retrieval step. That's all it is; it's the natural Phase 2.

When we do build it, it's **purely additive**: add a `searchKnowledgeBase` tool next to `queryProducts` in `tools/`; the orchestrator, guardrails, and endpoint don't change. Keep the same agnostic discipline — **do not hard-wire it to any one vector backend or embedding provider**, even though Mongo Atlas gives us convenient built-in options:

- **Vector backend behind an interface.** Add `src/lib/ai-chat/vector/VectorStore.ts`:
  ```ts
  export interface VectorStore {
    upsert(items: { id: string; text: string; metadata?: Record<string, unknown> }[]): Promise<void>
    similaritySearch(query: string, limit: number): Promise<ScoredChunk[]>
  }
  ```
  Implementations are swappable via config/DI, exactly like `AI_PROVIDER`:
  - **`atlasVectorStore`** — Mongo Atlas `$vectorSearch` (built in; no extra infra while we're on Atlas). Still reached through an adapter method (`adapter.similaritySearch(...)`), so the core never imports the Mongo driver.
  - **`pgvectorVectorStore` / `pineconeVectorStore` / `qdrantVectorStore`** — if the DB or hosting ever changes, we write one new implementation and change one env var. Nothing else moves.
- **Embeddings stay provider-agnostic.** Add `resolveEmbeddingModel()` next to `resolveModel()`, driven by an env var (`EMBEDDING_PROVIDER` / `EMBEDDING_MODEL`), so we can switch between Gemini/OpenAI/etc. embeddings independently of the chat model.
- **No action now** — the only thing this phase asks of us is to keep the rule from §"one idea": no direct SDK/DB imports outside adapters + resolvers. Honor that and "add RAG" stays: one `VectorStore` impl + one embedding resolver + one tool.

## Verification

- **After 2:** a scratch script calling `generateText({ model: resolveModel(), prompt: 'hi' })` returns text on Gemini; flip `AI_PROVIDER=anthropic` (or `openai`) and confirm the other provider answers with no other code change — proves model-agnosticism.
- **After 3:** call `adapter.queryProducts({ brandName: '<real brand from CSV>' })` and confirm it returns real seeded rows; then a model + tool run where asking "show me products by X" triggers the tool with the right filter.
- **After 5:** call `runChat()` directly with "recommend a highly-rated moisturizer" — confirm the answer names real products from the DB, and that `chat-sessions` + `chat-messages` rows (with `toolResults`) appear in the admin UI. Send a follow-up on the same `sessionKey` and confirm context carries.
- **After 6:** `curl -X POST localhost:3000/chat -H 'content-type: application/json' -d '{"sessionKey":"t1","message":"..."}'`; also send an off-topic and an injection-style message and confirm guardrails block them.
- **After 7 (widget):** hold a multi-turn conversation in the UI and confirm history persistence and grounded answers.
- **DB-agnostic sanity:** none of the above required touching a DB driver — all data flows through Payload's Local API, confirming the Mongo move (and any future DB) is invisible to the chatbot.

### Critical files
- [src/payload.config.ts](src/payload.config.ts) — register collections (+ optional endpoint)
- `src/collections/chat/{PromptTemplates,ChatSessions,Messages}.ts` (new)
- `src/lib/ai-chat/orchestrator.ts`, `data/ChatDataAdapter.ts`, `data/payloadChatAdapter.ts`, `providers/resolveModel.ts`, `tools/queryProducts.ts` (new)
- `src/app/chat/route.ts` (new) — mirrors [src/app/my-route/route.ts](src/app/my-route/route.ts)
- [src/collections/Products.ts](src/collections/Products.ts) — query shape / indexed fields
- [src/seed/seed.ts](src/seed/seed.ts) — Local-API seeding pattern
- References: [ENDPOINTS.md](.claude/skills/payload/reference/ENDPOINTS.md), [QUERIES.md](.claude/skills/payload/reference/QUERIES.md), [ADAPTERS.md](.claude/skills/payload/reference/ADAPTERS.md)
