import 'dotenv/config'
import { generateText } from 'ai'
import { resolveModel } from './resolveModel'

// Throwaway verification for Step 2: proves the provider resolver works and that
// swapping AI_PROVIDER changes which LLM answers, with no other code change.
//
//   npm run ai:smoke                    # uses AI_PROVIDER from .env (default google)
//   AI_PROVIDER=anthropic npm run ai:smoke
const main = async () => {
  const provider = process.env.AI_PROVIDER ?? 'google'
  const { text } = await generateText({
    model: resolveModel(),
    prompt:
      'In one short sentence, say hello and name which AI model you are and specifically which model version you are.',
  })
  console.log(`[provider=${provider}] ->`, text)
  process.exit(0)
}

main().catch((err) => {
  console.error('Smoke test failed:', err)
  process.exit(1)
})
