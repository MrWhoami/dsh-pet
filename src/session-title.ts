/** Bound titles without splitting surrogate pairs or retaining malformed UTF-16. */
export function boundedSessionTitle(value: string): string {
  return Array.from(value.trim().toWellFormed()).slice(0, 80).join('')
}
