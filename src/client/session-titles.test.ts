import { describe, expect, it } from 'vitest'
import { sessionTitleSnapshot } from './session-titles.ts'

describe('sessionTitleSnapshot', () => {
  it.each([null, undefined])('handles an unavailable session map: %s', (byId) => {
    expect(sessionTitleSnapshot(byId, 'current', ['active'])).toEqual({ current: 'current', titles: {} })
  })
  it('prioritizes the current and active sessions and uses the GUI project title', () => {
    const rows = Object.fromEntries(Array.from({ length: 800 }, (_, index) => [String(index), { displayTitle: '项目' }]))
    const result = sessionTitleSnapshot(rows, '799', ['798'])
    expect(result.current).toBe('799')
    expect(result.titles['799']).toBe('项目')
    expect(result.titles['798']).toBe('项目')
    expect(Object.keys(result.titles)).toHaveLength(200)
  })

  it('fits the JSON limit even with multibyte IDs and escaped titles', () => {
    const rows = Object.fromEntries(Array.from({ length: 800 }, (_, index) => [String(index) + '鲸'.repeat(250), { displayTitle: '\u0001'.repeat(80) }]))
    const result = sessionTitleSnapshot(rows, undefined, [])
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(64 * 1024)
    expect(Object.keys(result.titles).length).toBeGreaterThan(0)
    expect(result.current).toBeNull()
  })
})
