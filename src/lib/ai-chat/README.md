# ai-chat

A model-, DB-, and platform-agnostic chatbot core. Answers questions about the
product catalog by **querying the database** (via LLM tool-calling) and grounding
the model's reply in real rows. No RAG yet — see the plan's §7 for the future path.

## How it fits together

```
runChat(input, adapter)        <- the one entry point (orchestrator.ts)
  ├─ providers/resolveModel    <- which LLM (AI_PROVIDER env; default Gemini Flash)
  ├─ guardrails/               <- input checks (rate limit, off-topic, injection)
  │                               + output transforms (PII redaction, length cap)
  ├─ tools/queryProducts       <- the LLM calls this to fetch real products
  ├─ prompts/render            <- {{placeholder}} substitution for system prompts
  └─ data/ChatDataAdapter      <- the ONLY seam that touches storage
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

## Storage (Payload collections)

- `prompt-templates` — content-managed system prompts, looked up by `key`.
- `chat-sessions` — one per conversation (`sessionKey` from the client).
- `chat-messages` — turns, with tool calls/results and token usage for audit.

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
- **New backend / DB** — implement `ChatDataAdapter` against it; nothing else moves.
- **RAG (future)** — add a `VectorStore` interface + `resolveEmbeddingModel()` and a
  `searchKnowledgeBase` tool. Documented only; not built. See the plan §7.
