import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../../payload.config'
import { runChat, createPayloadChatAdapter } from './index'

// Step 5 verification: drive runChat() directly (no HTTP). Confirms grounded
// answers, session/message persistence, guardrail blocking, and multi-turn context.
const main = async () => {
  const payload = await getPayload({ config })
  const adapter = createPayloadChatAdapter(payload)
  const sessionKey = `smoke-${Date.now()}`
  const templateKey = 'product-assistant'

  console.log('\n[1] First question:')
  const r1 = await runChat({ sessionKey, templateKey, message: 'Recommend a few highly rated products.' }, adapter)
  console.log('  blocked:', r1.blocked, '\n  answer:', r1.text)

  console.log('\n[2] Follow-up (tests context on same session):')
  const r2 = await runChat({ sessionKey, templateKey, message: 'Which of those has the most reviews?' }, adapter)
  console.log('  blocked:', r2.blocked, '\n  answer:', r2.text)

  console.log('\n[3] Off-topic (should be blocked by guardrails):')
  const r3 = await runChat({ sessionKey, templateKey, message: 'Write me a python script.' }, adapter)
  console.log('  blocked:', r3.blocked, '\n  answer:', r3.text)

  const session = await adapter.getOrCreateSession(sessionKey, templateKey)
  const msgs = await payload.count({
    collection: 'chat-messages',
    where: { session: { equals: session.id } },
  })
  console.log(`\n[4] Persisted messages for session ${session.id}: ${msgs.totalDocs}`)

  process.exit(0)
}

main().catch((err) => {
  console.error('Orchestrator smoke test failed:', err)
  process.exit(1)
})
