import configPromise from '@payload-config'
import { getPayload } from 'payload'
import { runChat, createPayloadChatAdapter } from '@/lib/ai-chat'

// POST /chat — the chatbot endpoint. Placed OUTSIDE /api/* to avoid Payload's
// own /api/[...slug] catch-all. All chat logic lives in src/lib/ai-chat; this
// handler only adapts HTTP <-> runChat().
export const POST = async (request: Request) => {
  let body: { sessionKey?: unknown; message?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : ''
  const message = typeof body.message === 'string' ? body.message.trim() : ''

  if (!sessionKey || !message) {
    return Response.json(
      { error: 'Both "sessionKey" and "message" are required.' },
      { status: 400 },
    )
  }

  try {
    const payload = await getPayload({ config: configPromise })
    const adapter = createPayloadChatAdapter(payload)
    const result = await runChat(
      { sessionKey, message, templateKey: 'product-assistant' },
      adapter,
    )
    return Response.json(result)
  } catch (err) {
    console.error('[POST /chat] failed:', err)
    return Response.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
