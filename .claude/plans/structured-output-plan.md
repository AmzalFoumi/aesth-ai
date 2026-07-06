# AI Chatbot — Phase 3: Structured Output (Route B — model self-selects one of many shapes)

> Additive to the shipped DB/RAG chatbot. The tool loop, guardrails, prompt, history, persistence
> and HTTP contract are all preserved. This layer changes **only the container the final answer comes
> out in** — from a prose string to a typed, shape-tagged object the frontend can render as a real
> component (timeline, product cards, comparison table, or plain text).
> **GIT IS 100% MANUAL** — Claude never runs git and STOPS at every 🛑 gate with a ready-to-paste
> commit message, exactly like Phase 1 & 2.

---

## Context — why we're doing this

Today the bot's final answer is a **prose string** (`result.text` in
[orchestrator.ts:78-84](../../src/lib/ai-chat/orchestrator.ts#L78-L84), returned as `{ text }` in
[orchestrator.ts:109](../../src/lib/ai-chat/orchestrator.ts#L109)). A human reads it fine, but the React
frontend can't tell "step 1" from "a product link" — it's one undifferentiated blob. Lakindu asked:
*for a "how do I treat X" question, can we get organised JSON to render a real process timeline?*
Answer today = no. This phase makes it yes.

We are building **Route B (self-select)**: define several answer **shapes** (plain, timeline,
productList, comparison) as one **Zod discriminated union**, and let the **main model pick the branch
while it answers** — one model call, full question context, smartest choice. Confirmed against AI SDK
v7 docs: `generateText` supports `output: Output.object({ schema })` **alongside `tools`**, so the
RAG/DB retrieval loop is untouched and the model still returns a typed object. Result comes back as
`result.output` (the v7 stable name; `experimental_output` is deprecated).

**The other three options** (plain-text-only, pre-classifier/router-first, post-output reshaping) are
NOT built — they are written up for the team in a design-rationale doc (Step 1) that ships **inside the
ai-chat library** next to `PORTING.md`/`README.md`, so the choice is committed, travels with the copied
core, and is not lost in chat.

**Agnostic "allowed shapes" switch (explicit requirement).** Just like `RetrievalMode`
(`db`/`rag`/`both`) is an env seam, the set of shapes the model may use is an env allowlist:
`OUTPUT_SHAPES=plain,timeline,productList,comparison`, overridable per request. The discriminated
union is **built dynamically from the allowed set** (mirroring how `buildTools` registers tools per
mode). A prod copy can ship `OUTPUT_SHAPES=plain` and behave exactly like today, or any subset, with
**zero code change** — and the whole `output/` folder copies over untouched, matching the porting rule.

**Why not two calls (`generateText` then `generateObject`)?** `generateObject` cannot use tools, so a
two-call design would run the tool loop, throw away the model's own answer, then re-read it into a
shape — an extra call that can distort facts (this is exactly the weak "post-output" option). The
single `generateText + output` call keeps the model's grounded answer AND types it in one shot.

---

## Intern-level walkthrough (read before the steps)

```
POST /chat { sessionKey, message, mode?, shapes? }
  runChat()                                              ← same orchestrator, one added seam
    ├─ resolveMode(mode)      → which retrieval tools exist  (UNCHANGED, Phase 2)
    ├─ resolveShapes(shapes)  → which answer shapes are allowed  (NEW seam)
    └─ generateText({
         tools:  buildTools(adapter, mode),             ← RAG/DB loop, UNCHANGED
         output: buildOutput(shapes),                   ← NEW: Output.object(discriminatedUnion(allowed))
         stopWhen: stepCountIs(4),                       ← tool-call → read rows → compose typed answer
       })
         model calls searchKnowledgeBase(...) as before
         model then emits e.g. { kind:'timeline', spokenAnswer:"...", steps:[{order,title,detail}] }
    ├─ output guardrails run on output.spokenAnswer      ← every shape carries a plain-text answer
    ├─ persist: content = spokenAnswer, + structured output json, + mode/shape stamps
    └─ return { output, kind, text: spokenAnswer, mode }
frontend: switch (output.kind) → <Timeline/> | <ProductCards/> | <Comparison/> | <PlainText/>
```

**Key insight:** structured output is a layer ON TOP of retrieval. It does not touch how facts are
fetched — only how the finished answer is packaged. Every shape includes a `spokenAnswer` string so
guardrails, message persistence, and a text-only fallback all keep working unchanged.

---

## The four shapes (the discriminated union)

Discriminant field: `kind`. Every branch also carries `spokenAnswer: string` (the plain answer used
for guardrails, persistence, and as the graceful text fallback).

```
kind:'plain'        { spokenAnswer }                                   ← always available; the fallback
kind:'timeline'     { spokenAnswer, title, steps:[{order,title,detail,productRefs?}] }
kind:'productList'  { spokenAnswer, intro?, products:[{name,brand?,priceRange?,rating?,url?,why?}] }
kind:'comparison'   { spokenAnswer, items:[string], rows:[{feature, values:[string]}] }
```
`plain` MUST always be in the allowlist (it's the fallback); `resolveShapes` enforces this. Product
fields mirror the existing lean `ProductSummary` in [types.ts:26-35](../../src/lib/ai-chat/types.ts#L26-L35)
so the model reuses the same vocabulary the tools already return.

---

## New / changed files (map)

**New (core — NO `payload`/DB imports; copies over untouched, like `retrieval/`):**
```
src/lib/ai-chat/output/
  shapes.ts        # Zod schema per shape (each with kind + spokenAnswer); OUTPUT_SHAPE registry
  mode.ts          # OutputShape type + resolveShapes(override?) env allowlist (mirrors retrieval/mode.ts); forces 'plain' in
  buildOutput.ts   # buildOutput(shapes) → Output.object({ schema: discriminatedUnion(allowed branches) })
```
**Changed (small, additive):**
```
src/lib/ai-chat/orchestrator.ts   # accept shapes override; add output:buildOutput(...) to generateText;
                                  #   bump stopWhen to stepCountIs(4); guardrails on output.spokenAnswer;
                                  #   persist structured output; return { output, kind, text, mode }
src/lib/ai-chat/types.ts          # + OutputShape, the four shape interfaces, ChatOutput union; extend RunChatResult + NewMessage
src/lib/ai-chat/index.ts          # export resolveShapes, buildOutput, shape types
src/app/chat/route.ts             # read optional body.shapes; forward to runChat
src/lib/ai-chat/data/ChatDataAdapter.ts + payloadChatAdapter.ts  # persist structured output (see Step 5)
src/collections/chat/Messages*.ts # + structuredOutput (json) + outputShape (text) fields for auditability
src/seed/seedPrompt.ts            # add one generic line telling the model to answer in the shape that best fits
```
**Frontend:**
```
the chat widget/demo component     # switch(output.kind) → Timeline / ProductCards / Comparison / PlainText render
```
**Docs / env:**
```
src/lib/ai-chat/STRUCTURED-OUTPUT.md   # the 4-options design-rationale doc, ships with the library (Step 1)
.claude/plans/structured-output-plan.md # this plan, committed in-repo (Step 0)
src/lib/ai-chat/PORTING.md              # add the output/ seam + OUTPUT_SHAPES to the porting contract
.env / .env.example                     # + OUTPUT_SHAPES=plain,timeline,productList,comparison
```
Reuse existing patterns: `retrieval/mode.ts` (mirror for `resolveShapes`), `tools/index.ts`
(mirror the "build-from-allowed-set" idea for `buildOutput`), `ProductSummary` (reuse product fields).

---

## Build order — STOP GATES + manual commit messages

> At each 🛑 Claude summarizes the change, shows verification, prints the commit message, and STOPS
> until you say continue. Claude runs **no git commands**.

### Step 0 — Persist this plan in the repo
- Copy this plan to `.claude/plans/structured-output-plan.md` so it lives beside the Phase 1 & 2 plans.
- **Verify:** file exists under `.claude/plans/`.
- 🛑 **GATE 0**
  ```
  docs: add structured-output (phase 3) implementation plan

  - add .claude/plans/structured-output-plan.md: route-B self-select, Zod discriminated union, env-driven OUTPUT_SHAPES allowlist
  ```

### Step 1 — Options documentation (ships with the library)
- Add `src/lib/ai-chat/STRUCTURED-OUTPUT.md` (next to `PORTING.md`/`README.md` so it's committed and
  copies over with the core), intern-level, covering all four options with pros/cons and WHERE the
  shape decision happens:
  1. **Plain text** — today's behaviour; simplest; not renderable as structured UI.
  2. **Pre-classifier / router-first** — cheap classify call picks the shape *before* the main model
     answers (two calls; "receptionist"); easy to debug, can misroute.
  3. **Self-selection (CHOSEN)** — one `generateText + output` call, model picks the union branch
     while answering; smartest, minimal change; the branch it picks is occasionally odd.
  4. **Post-output reshaping** — model answers in prose, a second call reshapes it (can distort facts;
     weakest). Note `generateObject` can't use tools, which is *why* self-select (via `output`) wins.
- **Verify:** doc exists inside `src/lib/ai-chat/`; the four options and the "where does the decision
  happen" axis are all present; `README.md` cross-links to it.
- 🛑 **GATE 1**
  ```
  docs: document structured-output design options

  - add src/lib/ai-chat/STRUCTURED-OUTPUT.md comparing plain-text, pre-classifier, self-selection, post-output reshaping
  - record why route B (self-select via generateText output) was chosen; cross-link from README
  ```

### Step 2 — Shape schemas + allowed-shapes seam (pure, no payload)
- Add `output/shapes.ts`: a Zod schema per shape (`plain`, `timeline`, `productList`, `comparison`),
  each with `kind` literal + `spokenAnswer` + its shape-specific fields; export a registry map
  `{ plain, timeline, productList, comparison }`.
- Add `output/mode.ts`: `OutputShape` union type + `resolveShapes(override?)` =
  parse `override ?? process.env.OUTPUT_SHAPES ?? 'plain'` (comma list), validate against the registry,
  **always include `plain`**, dedupe. Mirror `retrieval/mode.ts`.
- Add `output/buildOutput.ts`: `buildOutput(shapes)` → `Output.object({ schema })` where `schema` is
  `z.discriminatedUnion('kind', allowedBranches)`; if only `plain` is allowed, use the plain schema
  directly (a 1-branch union is fine but keep it simple).
- Add types to `types.ts` (`OutputShape`, the four interfaces, `ChatOutput` union) and export from `index.ts`.
- Add `.env` / `.env.example`: `OUTPUT_SHAPES=plain,timeline,productList,comparison`.
- **Verify:** scratch script: `resolveShapes('timeline')` → `['plain','timeline']`;
  `resolveShapes(undefined)` honours env; `buildOutput(['plain','timeline'])` returns an `Output` whose
  JSON schema shows both branches; a bad name is dropped, `plain` always present.
- 🛑 **GATE 2**
  ```
  feat: add structured-output shape schemas and OUTPUT_SHAPES seam

  - add plain/timeline/productList/comparison Zod schemas (each carries kind + spokenAnswer)
  - add resolveShapes() env allowlist (mirrors RetrievalMode) and buildOutput() discriminated-union builder
  - plain shape is always allowed as the text fallback
  ```

### Step 3 — Wire structured output into the orchestrator
- `runChat` accepts optional `shapes` override; call `resolveShapes(input.shapes)`.
- Add `output: buildOutput(shapes)` to the existing `generateText` call; bump
  `stopWhen: stepCountIs(3)` → `stepCountIs(4)` (tool-call → read rows → compose typed answer).
- Read `result.output`; run output guardrails on `output.spokenAnswer` (not `result.text`); if blocked
  or empty, fall back to `{ kind:'plain', spokenAnswer: FALLBACK }`.
- Extend `RunChatResult` to `{ output, kind, text: spokenAnswer, sessionKey, blocked, mode }` (keep
  `text` for backward-compat with any current caller).
- **Verify:** `runChat({...})` with `OUTPUT_SHAPES=plain,timeline` on "walk me through treating dry
  skin" returns `output.kind==='timeline'` with populated `steps`; a "moisturizers under 5000" query
  returns `plain` or `productList`; retrieval (`toolResults`) still logged.
- 🛑 **GATE 3**
  ```
  feat: return structured typed output from runChat

  - generateText now emits a shape-tagged object via output:buildOutput(shapes) alongside the tool loop
  - guardrails + persistence run on output.spokenAnswer; graceful plain-text fallback
  - RunChatResult gains { output, kind }; keeps text for back-compat
  ```

### Step 4 — Prompt nudge + route pass-through
- `seedPrompt.ts`: add one generic line, e.g. *"Answer in the response shape that best fits the
  question — a step-by-step timeline for processes, a product list for recommendations, a comparison
  for 'X vs Y', otherwise a plain answer."* (Stays valid whatever subset `OUTPUT_SHAPES` allows.)
  Re-run `npm run seed:prompt` (or the existing prompt-seed command).
- `route.ts`: read optional `body.shapes` (string or comma list) and forward to `runChat`.
- **Verify:** POST with `{"shapes":"timeline"}` forces timeline-or-plain; same message without it uses
  env default; prompt template updated in admin.
- 🛑 **GATE 4**
  ```
  feat: nudge model toward best-fit shape and allow per-request shapes override

  - seed prompt asks the model to choose the fitting response shape
  - POST /chat forwards optional body.shapes to runChat
  ```

### Step 5 — Persist the structured output (auditability)
- Add `structuredOutput` (json) + `outputShape` (text) fields to the chat-messages collection
  (`src/collections/chat/…`); extend `NewMessage` in `types.ts`.
- In the orchestrator's assistant-message save, store the full `output` object + `kind` (alongside the
  existing `toolCalls`/`toolResults`/`retrievalMode`). `content` stays = `spokenAnswer`.
- Implement the passthrough in `ChatDataAdapter`/`payloadChatAdapter.ts` (only the two new fields).
- **Verify:** after a timeline answer, the `chat-messages` row shows `outputShape='timeline'` and the
  full `structuredOutput` json; `content` still holds the readable answer.
- 🛑 **GATE 5**
  ```
  feat: persist structured output and shape on chat messages

  - add structuredOutput (json) + outputShape (text) fields; store full typed output per assistant turn
  - keeps content = spokenAnswer for readability and text-only clients
  ```

### Step 6 — Minimal frontend render (visible demo)
- In the chat widget/demo component, `switch (output.kind)`:
  `timeline` → ordered step list; `productList` → simple cards; `comparison` → a table;
  `plain`/default → the existing text bubble. Keep styling minimal — goal is a visible, correct demo.
- Send optional `shapes` from the widget (a small selector) so you can flip shapes live like the
  `mode` A/B toggle.
- **Verify:** in the browser, "how do I treat dry skin?" renders a real step timeline; a shopping
  question renders cards; toggling the shape selector changes the rendered structure.
- 🛑 **GATE 6**
  ```
  feat: render structured answer shapes in the chat widget

  - switch on output.kind to render timeline / product cards / comparison / plain text
  - add a shape selector mirroring the retrieval-mode toggle for live demos
  ```

### Step 7 — Update the portability contract
- Add to `src/lib/ai-chat/PORTING.md`: `output/` (shapes.ts, mode.ts, buildOutput.ts) is **copy-as-is
  portable core**; `OUTPUT_SHAPES` is a per-project env knob (prod may ship `plain` only); the widget
  render + the two new message fields are **host glue** to rewrite per project. Note the hard rule
  still holds: nothing in `output/` imports payload/DB/SDK.
- **Verify:** PORTING.md classifies every new file; `OUTPUT_SHAPES` documented next to `RETRIEVAL_MODE`.
- 🛑 **GATE 7**
  ```
  docs: extend PORTING guide with the structured-output seam

  - classify output/ as portable core; document OUTPUT_SHAPES env and the host-glue render/persistence bits
  ```

---

## Verification (end-to-end)
1. `OUTPUT_SHAPES=plain,timeline,productList,comparison` in `.env`; prompt re-seeded.
2. `curl -X POST localhost:3000/chat -d '{"sessionKey":"t1","message":"walk me through treating dry skin"}'`
   → `output.kind==='timeline'`, populated `steps`, `text` still readable.
3. Shopping question → `productList`; "CeraVe vs Cetaphl cleanser" → `comparison`; off-topic → `plain`.
4. Set `OUTPUT_SHAPES=plain` → every answer is `plain` (proves the agnostic switch; prod-safe default).
5. Per-request `{"shapes":"timeline"}` overrides env for that call.
6. `chat-messages` rows show `outputShape` + `structuredOutput`; retrieval `toolResults` still logged.
7. Widget renders the matching component per `kind`; shape selector flips it live.
8. Swap check: `output/` imports no payload/SDK (tsc clean); copies untouched per PORTING.md.

## Decisions locked (via clarification)
- **Shapes:** plain (always), timeline, productList, comparison.
- **Route:** B / self-select — one `generateText` call with `output: Output.object(discriminatedUnion)`
  alongside the existing tool loop (AI SDK v7 `output`, not deprecated `experimental_output`).
- **Switch:** `OUTPUT_SHAPES` env allowlist + per-request `shapes` override, `plain` always forced in;
  union built dynamically from the allowed set; the `output/` folder is copy-as-is portable core.
- **Scope:** backend + minimal frontend render so the timeline is visibly demoable.
- **Not built (documented only):** plain-only, pre-classifier, post-output reshaping.
