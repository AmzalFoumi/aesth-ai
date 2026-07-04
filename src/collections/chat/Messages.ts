import type { CollectionConfig } from 'payload'

// Server-only: written by the chat orchestrator via the Local API. Admins can
// read for auditing ("why did the bot say that"); public REST access is denied.
const adminOnly = ({ req }: { req: { user?: unknown } }) => Boolean(req.user)

export const Messages: CollectionConfig = {
  slug: 'chat-messages',
  admin: {
    useAsTitle: 'role',
    defaultColumns: ['role', 'session', 'createdAt'],
    description: 'Individual chat turns. One row per user/assistant/tool message.',
  },
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  fields: [
    {
      name: 'session',
      type: 'relationship',
      relationTo: 'chat-sessions',
      required: true,
      index: true,
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      options: [
        { label: 'User', value: 'user' },
        { label: 'Assistant', value: 'assistant' },
        { label: 'Tool', value: 'tool' },
        { label: 'System', value: 'system' },
      ],
    },
    {
      name: 'content',
      type: 'textarea',
    },
    {
      name: 'toolCalls',
      type: 'json',
      admin: { description: 'Which tool the model called and with what arguments.' },
    },
    {
      name: 'toolResults',
      type: 'json',
      admin: { description: 'Rows returned to the model — traces answers back to real data.' },
    },
    {
      name: 'guardrailFlags',
      type: 'json',
      admin: { description: 'Guardrail outcome for this turn (audit trail).' },
    },
    {
      name: 'tokenUsage',
      type: 'json',
      admin: { description: 'Token counts from the model call (cost tracking).' },
    },
  ],
}
