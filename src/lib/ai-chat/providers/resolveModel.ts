import { google } from '@ai-sdk/google'
import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'

/**
 * The model-agnostic seam.
 *
 * Business code (orchestrator, tools, guardrails) imports ONLY this function and
 * never a provider SDK directly. Switching providers is a one-line env change:
 *
 *   AI_PROVIDER=google   (default) -> Gemini Flash free tier
 *   AI_PROVIDER=anthropic          -> Claude
 *   AI_PROVIDER=openai             -> GPT
 *
 * Optionally override the model id per provider with AI_MODEL.
 */
export const resolveModel = (): LanguageModel => {
  const provider = process.env.AI_PROVIDER ?? 'google'
  const modelId = process.env.AI_MODEL

  switch (provider) {
    case 'anthropic':
      return anthropic(modelId ?? 'claude-sonnet-4-5')
    case 'openai':
      return openai(modelId ?? 'gpt-4o-mini')
    case 'google':
      return google(modelId ?? 'gemini-2.0-flash')
    default:
      throw new Error(
        `Unknown AI_PROVIDER "${provider}". Use one of: google, anthropic, openai.`,
      )
  }
}
