import type { CollectionConfig } from 'payload'

// Admin-only: only authenticated users may read/write. The chatbot server reads
// these through the Local API (which bypasses access control), so nothing is
// exposed publicly. Editors manage prompt copy here without a code deploy.
const adminOnly = ({ req }: { req: { user?: unknown } }) => Boolean(req.user)

export const PromptTemplates: CollectionConfig = {
  slug: 'prompt-templates',
  admin: {
    useAsTitle: 'label',
    defaultColumns: ['key', 'label', 'version', 'isActive'],
    description: 'Content-managed system prompts for the chatbot. Looked up by "key".',
  },
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  fields: [
    {
      name: 'key',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { description: 'Stable identifier the code looks up, e.g. "product-assistant".' },
    },
    {
      name: 'label',
      type: 'text',
      required: true,
      admin: { description: 'Human-friendly name shown in the admin list.' },
    },
    {
      name: 'systemPrompt',
      type: 'textarea',
      required: true,
      admin: {
        description:
          'The system prompt. Supports {{placeholders}} substituted at runtime (e.g. {{now}}).',
      },
    },
    {
      name: 'version',
      type: 'number',
      defaultValue: 1,
      admin: { description: 'Bump when you meaningfully change the prompt.' },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      index: true,
      admin: { description: 'Only active templates are used at runtime.' },
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: { description: 'Optional changelog / rationale for non-engineers.' },
    },
  ],
}
