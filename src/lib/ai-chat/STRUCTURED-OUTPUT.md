# Structured output — design options

> How the chatbot's **final answer** gets shaped. This doc explains the four ways
> we could produce structured (renderable) answers instead of a plain prose blob,
> which one we picked, and why. If you're new to LLMs, read the "mental model"
> first. The chosen approach (Route B) is implemented under [`output/`](./output).

---

## The problem in one paragraph

Today `runChat` returns a **prose string** — one blob of English. A human reads it
fine, but the frontend can't tell "step 1 of a routine" from "a product link" from
"a comparison". So it can only render a text bubble. If we want a real **process
timeline**, a **product-card grid**, or a **comparison table**, the model has to
hand us **labelled JSON** ("this part is step 1, this part is a product") instead of
prose. That labelled-JSON idea is **structured output**. Same AI, different *container*.

## Mental model (for LLM newcomers)

- **Retrieval** = *how facts are fetched*. That's the tool loop (`queryProducts` /
  `searchKnowledgeBase`) and it is **not** what this doc is about — it stays the same.
- **Structured output** = *what container the finished answer comes out in*. A layer
  that sits ON TOP of retrieval. Prose string → typed, shape-tagged object.
- **Schema** = the "form with labelled boxes" the model must fill. We write it in Zod.
- **Discriminated union** = "the answer is EITHER a timeline OR a product list OR a
  comparison OR plain text". A `kind` field says which one, and the rest of the boxes
  depend on that `kind`.

The interesting question is not *whether* to use structured output — it's **WHERE the
"which shape?" decision happens**. That's the axis the four options differ on.

---

## The four options

### 1. Plain text (what we had before)
The model writes prose; the frontend shows a text bubble. The "which shape" decision
**never happens** — there's only one shape.

- ✅ Simplest; maximally flexible wording; one model call.
- ❌ Not renderable as structured UI. No timeline, no cards.
- *Analogy:* the expert just talks; nobody files the answer into a form.

### 2. Pre-classifier / router-first — decide **before** answering
A cheap, fast first call classifies the raw question ("this is a process question →
timeline"). Then the main call answers, told to use that one shape.

- ✅ Clean separation; easy to debug ("why timeline? look at the classifier's output").
- ❌ **Two model calls.** The classifier can guess wrong *before* the model has even
  understood the question, and then the good model is locked into a bad shape.
- *Analogy:* a **receptionist** reads your question and routes you to a department
  before you've spoken to the expert.

### 3. Self-selection — decide **while** answering  ✅ **CHOSEN (Route B)**
Give the model **all** the shapes at once as one discriminated union, and it picks the
branch as it writes. **One call.** In AI SDK v7 this is `generateText({ tools, output:
Output.object({ schema }) })` — crucially, `output` works **alongside `tools`**, so the
retrieval loop is untouched and the same call returns a typed object (`result.output`).

- ✅ **One call.** The model already understood the question, so its shape choice is
  usually smarter than a separate classifier. Minimal change to the orchestrator — the
  tool loop, guardrails, and persistence all stay. The whole `output/` folder is
  provider-/DB-agnostic and copies to another project untouched.
- ❌ Slightly richer schema to maintain; occasionally the model picks an odd branch
  (mitigated by a light prompt nudge + always allowing the `plain` fallback).
- *Analogy:* the **expert answers you AND files it in the right folder** in one motion.

### 4. Post-output reshaping — decide **after** answering
The model answers in prose (like option 1), then a **second** call reads that prose and
reformats it into a shape.

- ✅ Barely touches the current pipeline; you bolt formatting on at the very end.
- ❌ Extra call, and the reformat step works from *English*, not the source data, so it
  can **lose or distort facts**. Also: AI SDK's `generateObject` (the natural tool here)
  **cannot use tools** — which is exactly *why* Route B, using `generateText` + `output`,
  is the clean way to get tools **and** structure in one call.
- *Analogy:* a **typist** re-types the expert's spoken answer into a form afterwards.

---

## Where each option makes the decision

| Option | Model calls | "Which shape?" decided | Tools + structure same call? | Verdict |
| --- | --- | --- | --- | --- |
| 1. Plain text | 1 | never (one shape) | n/a | too limited |
| 2. Pre-classifier | 2 | before answering | no | debuggable, can misroute |
| 3. **Self-selection** | **1** | **while answering** | **yes (`output` + `tools`)** | **chosen** |
| 4. Post-output | 2 | after answering | no (`generateObject` has no tools) | fact-distortion risk |

---

## What we built (Route B), briefly

- **Shapes:** `plain` (always available — the fallback), `timeline`, `productList`,
  `comparison`. Every shape also carries a `spokenAnswer` string, so guardrails,
  message persistence, and text-only clients keep working unchanged.
- **Agnostic switch:** which shapes the model may use is an env allowlist
  `OUTPUT_SHAPES=plain,timeline,productList,comparison`, overridable per request —
  exactly like the `RETRIEVAL_MODE` seam. The discriminated union is built dynamically
  from the allowed set, so a prod copy can ship `OUTPUT_SHAPES=plain` and behave like
  today with **zero code change**.
- **One seam, one call:** `output: buildOutput(shapes)` is added to the existing
  `generateText` call in the orchestrator; retrieval is not touched.

See [`output/`](./output) for the schemas (`shapes.ts`), the allowlist resolver
(`mode.ts`), and the union builder (`buildOutput.ts`).

---

## Understanding checklist

- [ ] Why prose can't be rendered as a timeline, and what "structured output" fixes.
- [ ] The difference between *retrieval* (how facts are fetched) and *output shape*
      (how the answer is packaged) — and why structure sits on top of retrieval.
- [ ] The real axis between options: **where** the shape decision happens
      (never / before / during / after).
- [ ] Why self-selection (Route B) needs `generateText` + `output`, not `generateObject`
      (which can't call tools).
- [ ] Why every shape carries `spokenAnswer` (guardrails + persistence + text fallback).
- [ ] How `OUTPUT_SHAPES` makes the shape set an agnostic, copyable env switch.
