import 'dotenv/config'
import { generateText, stepCountIs } from 'ai'
import { getPayload } from 'payload'
import config from '../../../payload.config'
import { resolveModel } from '../providers/resolveModel'
import { createPayloadChatAdapter } from '../data/payloadChatAdapter'
import { buildTools } from './index'

// Step 3 verification: (1) the adapter returns real rows directly, and (2) the LLM
// chooses to call the queryProducts tool and answers from the returned data.
const main = async () => {
  const payload = await getPayload({ config })
  const adapter = createPayloadChatAdapter(payload)

  // (1) direct adapter call — grab a real brand from the catalog first
  const sample = await adapter.queryProducts({ limit: 3 })
  console.log('\n[1] Direct adapter.queryProducts({limit:3}):')
  console.log(sample.map((p) => `  - ${p.productName} (${p.brandName ?? '?'}) ★${p.averageRating ?? '?'}`).join('\n'))

  const brand = sample[0]?.brandName
  if (brand) {
    const byBrand = await adapter.queryProducts({ brandName: brand, limit: 3 })
    console.log(`\n[1b] Filtered by brand "${brand}": ${byBrand.length} rows`)
  }

  // (2) model + tool call in isolation (no guardrails/storage yet)
  const { text, steps } = await generateText({
    model: resolveModel(),
    tools: buildTools(adapter),
    stopWhen: stepCountIs(3),
    prompt: brand
      ? `What products do you have from the brand "${brand}"? List a few.`
      : 'Show me a few highly rated products.',
  })
  const toolCalls = steps.flatMap((s) => s.toolCalls ?? [])
  console.log(`\n[2] Model made ${toolCalls.length} tool call(s):`, toolCalls.map((t) => t.toolName))
  console.log('[2] Model answer:\n', text)

  process.exit(0)
}

main().catch((err) => {
  console.error('Tool smoke test failed:', err)
  process.exit(1)
})
