# Fix structured-output leak + animated loading + confirm cards

> Follow-up to [structured-output-plan.md](structured-output-plan.md) (Phase 3). That plan
> shipped the shape union; this plan covers hardening it against real model behavior once
> live traffic hit it.

## Context

The new full-stage chat homepage works, but two problems surfaced when talking to the advisor:

1. **Raw JSON leaks into the chat.** A `productList` answer renders as a pretty-printed
   JSON object in the bubble instead of product cards. Root cause traced to the backend:
   the default model (`gemini-3.1-flash-lite`) sometimes serializes the structured shape
   object into `result.text` instead of the AI SDK object channel. In
   `src/lib/ai-chat/orchestrator.ts`, `result.output` then throws → `modelOutput = null`,
   but `text` is the non-empty JSON blob, so the degrade guard at line 159
   (`!modelOutput?.spokenAnswer?.trim() && !text.trim()`) is skipped, and the blob is
   wrapped as `{ kind: 'plain', spokenAnswer: <JSON> }` and printed verbatim. The frontend
   card renderer is correct — it simply never receives `kind: 'productList'`.

2. **Loading indicator is a static `…`.** It reads as "frozen" during slow model calls.

Decisions from planning: stay on plain CSS (no shadcn/Tailwind/React Bits — they don't earn
their dependency cost here); backend only *recovers* the shape from text (no extra
JSON-stripping safety net for now). No third-party library is needed for the loading dots.

## Changes

### 1. Recover a structured shape from `result.text` — `src/lib/ai-chat/orchestrator.ts`

The fix goes in the `try` block after `modelOutput` is read (around lines 149–161), before
the degrade guard. When `modelOutput` is null but `text` is non-empty, attempt to recover:

- Add a helper (new file `src/lib/ai-chat/output/recoverShape.ts`, or a local function) that:
  - Trims `text`; if it doesn't start with `{`, bail (nothing to recover).
  - Strips a leading/trailing ```` ```json ```` / ```` ``` ```` fence if present (lighter
    models sometimes wrap the object in a code fence).
  - `JSON.parse` inside try/catch.
  - Validates the parsed value against the **allowed** shape union built from the resolved
    `shapes` — reuse `SHAPE_SCHEMAS` from `src/lib/ai-chat/output/shapes.ts` and build a
    `z.discriminatedUnion('kind', ...)` (mirror the logic in
    `src/lib/ai-chat/output/buildOutput.ts`; consider extracting a shared
    `buildShapeSchema(shapes)` so `buildOutput` and recovery use one source of truth).
  - On success returns the typed `ChatOutput`; on any failure returns `null`.
- In the orchestrator: if `modelOutput` is null and recovery succeeds, set
  `modelOutput = recovered` and set `text = ''` (so the JSON blob no longer flows into
  `spoken`/`finalText` at line 170). Then the existing code path produces
  `finalOutput = { ...modelOutput, spokenAnswer: finalText }` with the real `kind`.
- Leave the existing degrade-to-plain guard and the outer `catch → runPlain()` untouched;
  recovery only adds a branch that runs before the guard.

Net effect: a productList/timeline/comparison object emitted as text is parsed back into a
real `output.kind`, so the frontend renders cards/timeline/table instead of raw JSON.

### 2. Animated typing indicator — plain CSS

- `src/app/(frontend)/components/ChatWidget.tsx`: replace the literal `…` in the loading
  bubble (the `{loading && ...}` block, full variant and widget variant both reference the
  same `…`) with three `<span>` dots wrapped in a `.typing` element, e.g.
  `<span class="typing"><span></span><span></span><span></span></span>`.
- `src/app/(frontend)/styles.css`: add a `.typing` rule — three small dots using the
  existing `--muted` token, each animated with a staggered `@keyframes` opacity/translate
  bounce (animation-delay 0 / .15s / .3s). Wrap in `@media (prefers-reduced-motion: reduce)`
  to fall back to static dots (consistent with the existing `.status__pulse` guard).
- No third-party dependency required.

### 3. Confirm card rendering (no code change expected)

The `productList` branch in `StructuredAnswer` (`ChatWidget.tsx`) already renders the cards
with swatch/name/meta/why and the `.card*` classes exist in `styles.css`. After fix #1
delivers `kind: 'productList'`, verify the cards render. Only adjust if a field mismatch
shows up during verification (e.g. `rating` formatting, missing `url`).

### 4. Lenient recovery: patch missing-but-harmless fields before validating — `src/lib/ai-chat/output/recoverShape.ts`

**Status update (post Stage A/B live verification):** Stage A/B shipped and fixed the
plain-answer leak case (confirmed via curl and one live browser turn). But live browser
testing surfaced a **second leak still occurring**: a "Build me a nighttime routine"
request leaked raw `{"steps": [...]}` JSON instead of rendering as a timeline. Root cause:
`recoverShape()` requires the parsed JSON to pass **strict** schema validation
(`buildShapeSchema(shapes).safeParse`), which requires `spokenAnswer` on every shape. The
leaking blob's `steps` array matches the `timeline` signature key in `flattenWrapper()`
(so `kind` gets set correctly), but the object has no top-level `spokenAnswer` field — so
Zod validation still fails, `recoverShape` returns `null`, and the raw JSON falls through
to `spoken` unchanged. Same failure category as the original bug, different missing field.

**Correction after first Stage D pass:** patching `spokenAnswer` alone was not enough — live
retest showed the same timeline blob still leaking, and this time it *did* have
`spokenAnswer`. The actual missing field was the timeline shape's top-level `title`
(`timelineSchema` requires `title: string` in `shapes.ts:31`, separate from each step's own
`title`) — models routinely fill in every step's `title` but omit this outer one since it
doesn't map to a specific piece of content they're generating. Fixed by extending
`fillDefaults` to also default `title: 'Your Routine'` when `kind === 'timeline'` and
`title` is missing/non-string.

Fix: make recovery **best-effort** instead of all-or-nothing — patch obviously-missing,
harmless fields with safe defaults *before* validating, so a blob that's structurally the
right shape but missing a cosmetic field still recovers instead of leaking:

- In `recoverShape.ts`, after `flattenWrapper(parsed)` (or folded into it), add a
  `fillDefaults(obj)` step that runs before both `schema.safeParse` attempts:
  - If `spokenAnswer` is missing or not a string, set it to `''` (the orchestrator already
    falls back to `text`/FALLBACK when `spokenAnswer` is blank, so an empty string here is
    safe, not a silent data loss).
  - Only patch fields that are genuinely optional-in-spirit (safe defaults exist and
    omission doesn't imply the answer is wrong) — e.g. `spokenAnswer: ''`, missing `intro`
    left absent (already optional in the schema). Do **not** patch shape-defining/required
    array fields (`steps`, `products`, `rows`, `items`) — if those are missing or malformed,
    the blob isn't recoverable and should still fall through to plain text.
  - Keep this scoped to the same schema (`buildShapeSchema`) — we're filling gaps so the
    *existing* strict schema passes, not loosening the schema itself.
- Apply `fillDefaults` to both the direct-parse attempt and the `flattenWrapper` attempt in
  `recoverShape()`, so it helps whichever path actually matches the blob's shape.

This directly answers the "why not just build cards from this JSON" question: full
schema-free rendering was rejected as too permissive (risks rendering malformed/partial
data as if valid); patching known-safe missing fields keeps the schema as the gatekeeper
while covering the class of failure actually observed (model omits a cosmetic field, not a
structural one).

### 5. Superseding Stage D: make non-essential fields genuinely optional instead of faking them

**Direction change from the user**, replacing the `fillDefaults` approach in section 4:
rather than inventing placeholder content (`spokenAnswer: ''`, `title: 'Your Routine'`) to
satisfy a strict schema, make fields that aren't essential to the answer's meaning
*actually optional* in the schema/types, so whatever JSON the model returns renders as-is —
no invented text, no compulsory fields that don't carry information.

- `src/lib/ai-chat/output/shapes.ts`: the shared `spokenAnswer` field and `timelineSchema`'s
  top-level `title` are now `.optional()`. Structural fields that define the shape itself
  (`steps`, `products`, `rows`, `items`) remain required — those aren't decorative, without
  them there's no shape.
- `src/lib/ai-chat/types.ts`: mirrored `PlainOutput`/`TimelineOutput`/`ProductListOutput`/
  `ComparisonOutput` interfaces to mark `spokenAnswer?`/`title?` optional.
- `src/app/(frontend)/components/ChatWidget.tsx`: mirrored the inline `ChatOutput` type the
  same way. No rendering changes needed — `StructuredAnswer` already guards
  `{output.spokenAnswer && ...}` / `{output.title && ...}`, so missing fields just don't
  render, rather than showing a blank/fake line.
- `src/lib/ai-chat/output/recoverShape.ts`: removed `fillDefaults` entirely — with the
  fields genuinely optional in the schema, a blob missing them now validates directly, no
  patching required.
- `src/lib/ai-chat/orchestrator.ts` — two follow-on fixes required because `spokenAnswer`
  is no longer guaranteed present, so code that used its presence as a proxy for "is there
  a usable answer" needed correcting:
  - The "nothing usable, re-run plain" guard (previously
    `!modelOutput?.spokenAnswer?.trim() && !text.trim()`) now uses
    `hasUsableOutput = modelOutput && (modelOutput.kind !== 'plain' || modelOutput.spokenAnswer?.trim())`
    — a non-plain shape is self-sufficient via its own structural fields even without
    `spokenAnswer`; only `plain` needs its text to carry any content.
  - `finalText` synthesis no longer forces the generic `FALLBACK` apology onto a shape that
    has real structural content but no `spokenAnswer` — `hasStructuredContent` (same
    `kind !== 'plain'` check) gates that fallback, so `finalText` is `''` (hidden by the
    UI's existing conditional) instead of a spurious "Sorry, I couldn't produce..." line
    stamped over a perfectly good timeline/productList/comparison.

### 6. Comparison rows leaked as per-item keys instead of `values`

Live testing turned up a third variant of the same failure class: models routinely emit
comparison rows as `{ feature, "Product A": "x", "Product B": "y" }` (one key per compared
item) instead of the schema's `{ feature, values: [...] }`. Fixed with
`normalizeComparisonRows()` in `recoverShape.ts`: when a row is missing `values` but has
per-item keys, rebuild `values` from `items` order before validating. Same principle as
Stage E — recover a recognizable-but-differently-shaped answer rather than let it leak or
invent a stricter schema the model won't reliably hit.

## Files

- `src/lib/ai-chat/orchestrator.ts` — shape-recovery branch (done, Stage A); usable-output
  and finalText guards updated for optional `spokenAnswer` (Stage E).
- `src/lib/ai-chat/output/recoverShape.ts` — parse+validate text→ChatOutput (done, Stage A);
  `fillDefaults` added then removed once schema fields became genuinely optional (Stage E);
  `normalizeComparisonRows` added post-Stage-E for the per-item-key leak (item 6).
- `src/lib/ai-chat/output/shapes.ts` — `spokenAnswer`/timeline `title` made optional (Stage E).
- `src/lib/ai-chat/types.ts` — mirrored optional fields (Stage E).
- `src/lib/ai-chat/output/buildOutput.ts` — shared `buildShapeSchema` (done, Stage A).
- `src/app/(frontend)/components/ChatWidget.tsx` — animated typing markup (done, Stage B);
  mirrored optional fields (Stage E).
- `src/app/(frontend)/styles.css` — `.typing` keyframes (done, Stage B).

## Build order — STOP GATES + manual commit messages

> **GIT IS 100% MANUAL** — Claude never runs git and STOPS at every 🛑 gate with a
> ready-to-paste commit message. At each 🛑 Claude summarizes the change, shows the
> `npx tsc --noEmit` result, prints the commit message, and STOPS.

- **Stage A — Backend shape recovery** (fix #1): add `recoverShape.ts`, optional
  `buildOutput.ts` refactor to a shared `buildShapeSchema`, and the orchestrator branch
  that promotes recovered text→shape. `npx tsc --noEmit`.
- 🛑 **GATE A** — shipped as `b1f8c72 fix: recover structured shape when model serializes it into text`

- **Stage B — Animated loading dots** (fix #2): replace the static `…` with animated
  `.typing` dots in `ChatWidget.tsx` + `styles.css` keyframes (reduced-motion guarded).
  `npx tsc --noEmit`.
- 🛑 **GATE B** — shipped alongside Stage A commits (`feature: add recover shape functionality to AI chat`)

- **Stage C — Verify end-to-end** (fix #3): run the app, confirm productList/timeline/
  comparison render and dots animate. **Status: reopened.** Live browser testing found the
  plain-answer leak fixed, but a new timeline leak (`{"steps": [...]}`, missing
  `spokenAnswer`) — this is what Stage D fixes.
- 🛑 **GATE C** (superseded — folded into Stage D verification below; no separate commit)

- **Stage D — Lenient default-filling in recovery** (fix #4). **Superseded by Stage E** —
  fabricating placeholder values (`spokenAnswer: ''`, `title: 'Your Routine'`) was replaced
  by making those fields genuinely optional in the schema (see section 5). No commit made
  for Stage D alone.

- **Stage E — Make non-essential fields genuinely optional** (fix #5, replaces Stage
  D): `spokenAnswer` (all shapes) and timeline's top-level `title` marked `.optional()` in
  `shapes.ts`, mirrored in `types.ts` and `ChatWidget.tsx`; `fillDefaults` removed from
  `recoverShape.ts`; orchestrator's usable-output and finalText guards corrected to stop
  treating `spokenAnswer` presence as a proxy for "is there an answer." `npx tsc --noEmit`.
- 🛑 **GATE E** — shipped as `67085d8 fix: make spokenAnswer and timeline title optional instead of faking them`

- **Stage F — Comparison rows normalizer** (fix #6): `normalizeComparisonRows()` added to
  `recoverShape.ts` to rebuild `values` from per-item keys.
- 🛑 **GATE F** — shipped as `0f249a0 fix: recover comparison rows when model emits per-item keys instead of a values array`

## Verification

1. `npx tsc --noEmit` — clean typecheck.
2. `npm run dev` (Payload/Mongo must be up; seeded products required). Open the homepage.
3. Ask "Gentle cleanser for oily skin" (the exact prompt that leaked JSON in the screenshot).
   - Expect: product **cards** (ERHA / Cetaphil etc.), not a JSON blob.
   - While waiting: the three dots **animate**.
4. ✅ **Confirmed live (2026-07-07)**: `productList` renders as cards, `comparison` renders
   as a table. Both previously-leaking shapes are fixed and user-verified in the browser.
5. **Deferred: `timeline` live verification.** The seeded catalog doesn't currently have
   routine/step data to meaningfully exercise a "build me a routine" prompt, so this can't
   be tested end-to-end right now. No code is riding on this: Stage E's leniency
   (decorative fields optional, structural fields required) was applied uniformly across
   all three non-plain shapes, not as a shape-specific patch, so `timeline` should already
   be as leak-resistant as `productList`/`comparison` by construction. Revisit once
   routine/step content exists in the catalog, or if a raw `{"steps": [...]}` leak is
   observed live.
6. Re-ask the productList/comparison prompts a few more times over normal use — the leak
   was intermittent (model-dependent), so the clean pass in #4 isn't a permanent guarantee.
7. Optional: `npm run ai:smoke:chat` if it exercises the orchestrator, to confirm recovery
   without the browser.
8. Stop at the build gate for manual commit (no git run by Claude).

## Open question: would a bigger model remove the need for recovery entirely?

`recoverShape.ts` exists because the default model (`gemini-3.1-flash-lite`, an
intentionally light/free-tier model) sometimes fails to route its answer through the AI
SDK's structured-output (`output:`) channel and serializes it into `result.text` instead.
`resolveModel()` (`src/lib/ai-chat/providers/resolveModel.ts`) already makes the model a
one-line env swap with no code change: `AI_PROVIDER=anthropic` (defaults to
`claude-sonnet-4-5`) or `AI_PROVIDER=openai` (defaults to `gpt-4o-mini`), optionally with
`AI_MODEL` to pin a specific id.

Worth testing empirically: point `AI_PROVIDER` at a stronger model and re-run the same
leak-prone prompts. If a bigger model reliably uses the SDK's native `output` object and
never falls into the `result.text` leak path, `recoverShape()` becomes a pure safety net
(cheap to keep — it only activates when `modelOutput` is null) rather than the primary
mechanism carrying correctness. It would NOT be removed — lighter/free-tier models remain a
legitimate deployment target and the recovery path costs nothing when unused — but it tells
us whether the current reliance on recovery is a model-tier problem or a schema-design
problem. Not yet tested this session; needs an API key for whichever provider is tried plus
a manual `npm run dev` pass.
