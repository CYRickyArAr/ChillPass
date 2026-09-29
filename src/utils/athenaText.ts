/** Model responses and older imports can contain structured values despite TS string types.
 * Preserve every JSON field instead of rendering an object as a React child or discarding it.
 * This conversion alone never rewrites stored records.
 */
export function athenaText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (typeof value === 'object') {
    try { return JSON.stringify(value, null, 2) ?? '' } catch { return String(value) }
  }
  return String(value)
}
