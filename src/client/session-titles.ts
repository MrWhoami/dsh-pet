import { boundedSessionTitle } from '../session-title.ts'

/** A bounded GUI title snapshot for the desktop companion's 64 KiB API. */
export function sessionTitleSnapshot(
  byId: Readonly<Record<string, { displayTitle?: string; title?: string } | undefined>> | null | undefined,
  current: string | undefined,
  active: readonly string[],
): { titles: Record<string, string>; current: string | null } {
  const titles: Record<string, string> = Object.create(null)
  const ids = new Set([...(current === undefined ? [] : [current]), ...active, ...Object.keys(byId ?? {})])
  const encoder = new TextEncoder()
  let bytes = 0
  let count = 0
  for (const id of ids) {
    if (count >= 200) break
    const row = byId?.[id]
    const title = boundedSessionTitle(row?.displayTitle ?? row?.title ?? '')
    if (!title || id.length > 256) continue
    const size = encoder.encode(JSON.stringify({ [id]: title })).byteLength
    if (bytes + size > 48 * 1024) continue
    titles[id] = title
    bytes += size
    count++
  }
  return { titles, current: current !== undefined && current.length <= 256 ? current : null }
}
