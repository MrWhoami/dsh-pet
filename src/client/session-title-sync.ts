import type { sessionTitleSnapshot } from './session-titles.ts'

type Snapshot = ReturnType<typeof sessionTitleSnapshot>
export type SessionTitleUpdate = Snapshot & { source: string; revision: number; focusedAt: number; release?: boolean }

const PAGE_SLOT = Symbol.for('dsh-pet.session-title-source')
interface PageSource { id: string; revision: number; focusedAt?: number }

/** A page keeps its source across plugin reloads; revisions order old in-flight requests. */
function pageSource(): PageSource {
  const page = globalThis as typeof globalThis & { [PAGE_SLOT]?: PageSource }
  if (page[PAGE_SLOT] === undefined) {
    const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('')
    page[PAGE_SLOT] = { id, revision: 0 }
  }
  return page[PAGE_SLOT]
}

/** Keep one request in flight and one latest pending snapshot, owned by this UI lifetime. */
export function createSessionTitleSync(
  send: (update: SessionTitleUpdate, signal: AbortSignal) => Promise<unknown>,
  page = pageSource(),
  now = () => performance.timeOrigin + performance.now(),
) {
  let disposed = false
  let suspended = false
  let unsupported = false
  let last = ''
  let hostInstance: string | undefined
  let pending: SessionTitleUpdate | undefined
  let controller: AbortController | undefined

  const flush = (): void => {
    if (disposed || unsupported || controller !== undefined || pending === undefined) return
    const update = pending
    pending = undefined
    const request = new AbortController()
    controller = request
    void send(update, request.signal).catch((error: unknown) => {
      if (controller !== request || disposed) return
      if (typeof error === 'object' && error !== null && 'status' in error && error.status === 404) {
        unsupported = true
        pending = undefined
        return
      }
      if (!disposed && pending === undefined) last = ''
    }).finally(() => {
      if (controller !== request) return
      controller = undefined
      flush()
    })
  }

  const reconnect = (): void => {
    controller?.abort()
    controller = undefined
    pending = undefined
    last = ''
    unsupported = false
  }

  return {
    reconnect,
    release(): SessionTitleUpdate | undefined {
      if (disposed || suspended) return undefined
      suspended = true
      reconnect()
      page.revision = Math.max(now(), page.revision + 0.001)
      page.focusedAt = 0
      return { source: page.id, revision: page.revision, focusedAt: 0, release: true, titles: {}, current: null }
    },
    resume(): void {
      suspended = false
      reconnect()
    },
    observeHost(instance: string | undefined): boolean {
      if (instance === undefined || instance === hostInstance) return false
      hostInstance = instance
      reconnect()
      return true
    },
    publish(snapshot: Snapshot, focused: boolean, force = false): void {
      if (disposed || suspended || unsupported) return
      const serialized = JSON.stringify({ ...snapshot, focused })
      if (!force && serialized === last) return
      last = serialized
      page.revision = Math.max(now(), page.revision + 0.001)
      if (focused) page.focusedAt = page.revision
      pending = { ...snapshot, source: page.id, revision: page.revision, focusedAt: page.focusedAt ?? 0 }
      flush()
    },
    dispose(): void {
      disposed = true
      pending = undefined
      controller?.abort()
    },
  }
}
