import { describe, expect, it } from 'vitest'
import { boundedSessionTitle } from './session-title.ts'
import { sessionTitleSnapshot } from './client/session-titles.ts'

describe('session title Unicode boundary', () => {
  it('keeps the 80th Unicode character intact in client and host truncation', () => {
    const title = 'A'.repeat(79) + '\u{1F600}' + 'tail'
    const snapshot = sessionTitleSnapshot({ s: { displayTitle: title } }, 's', [])
    expect(snapshot.titles.s).toBe('A'.repeat(79) + '\u{1F600}')
    expect(boundedSessionTitle(title)).toBe(snapshot.titles.s)
    expect(snapshot.titles.s!.isWellFormed()).toBe(true)
  })

  it('repairs malformed source text before sending it to the native client', () => {
    expect(boundedSessionTitle('x\ud83d')).toBe('x\ufffd')
  })
})
