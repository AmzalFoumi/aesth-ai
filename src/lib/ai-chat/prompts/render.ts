/**
 * Pure {{placeholder}} substitution for prompt templates. Unknown placeholders
 * are left untouched. No side effects, trivially testable.
 *
 *   renderTemplate('Today is {{now}}.', { now: '2026-07-04' })
 *   // -> 'Today is 2026-07-04.'
 */
export const renderTemplate = (
  template: string,
  vars: Record<string, string> = {},
): string =>
  template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) =>
    key in vars ? vars[key] : match,
  )
