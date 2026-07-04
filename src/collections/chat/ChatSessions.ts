import type { CollectionConfig } from 'payload'

// Server-only: the chatbot endpoint touches these via the Local API. Public REST
// access is denied; admins can view sessions in the panel for support/debugging.
const adminOnly = ({ req }: { req: { user?: unknown } }) => Boolean(req.user)

export const ChatSessions: CollectionConfig = {
  slug: 'chat-sessions',
  admin: {
    useAsTitle: 'sessionKey',
    defaultColumns: ['sessionKey', 'promptTemplateKey', 'status', 'updatedAt'],
    description: 'One row per chatbot conversation. Created server-side by the chat endpoint.',
  },
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  fields: [
    {
      name: 'sessionKey',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: 'Opaque client-generated UUID (localStorage). Not a Payload user.',
      },
    },
    {
      name: 'promptTemplateKey',
      type: 'text',
      admin: {
        description: 'Prompt template this session is pinned to, so later edits do not rewrite history.',
      },
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Archived', value: 'archived' },
        { label: 'Blocked', value: 'blocked' },
      ],
      admin: { description: 'A guardrail may flip this to "blocked" after repeated abuse.' },
    },
    {
      name: 'metadata',
      type: 'json',
      admin: {
        description: 'Free-form. A clientId/tenantId here is the seam for multi-site deployments.',
      },
    },
  ],
}
