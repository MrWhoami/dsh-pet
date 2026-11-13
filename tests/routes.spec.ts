import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { PetService } from '../src/service.ts'
import { makePetRoutes } from '../src/routes.ts'
import { loadPetRegistry } from '../src/registry.ts'

const WEBP_BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
const GIF_BYTES = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])

let dir: string
let server: Server
let port: number
let service: PetService
let routes: ReturnType<typeof makePetRoutes>

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-routes-'))
  const assets = join(dir, 'assets')
  mkdirSync(join(assets, 'whale'), { recursive: true })
  writeFileSync(join(assets, 'whale', 'pet.json'), JSON.stringify({
    id: 'whale-girl', displayName: '鲸鱼娘', spritesheetPath: 'spritesheet.webp',
  }), 'utf8')
  writeFileSync(join(assets, 'whale', 'spritesheet.webp'), WEBP_BYTES)
  mkdirSync(join(assets, 'whale', 'previews'), { recursive: true })
  writeFileSync(join(assets, 'whale', 'previews', 'idle.gif'), GIF_BYTES)
  mkdirSync(join(assets, 'otter'), { recursive: true })
  writeFileSync(join(assets, 'otter', 'pet.json'), JSON.stringify({
    id: 'otter', displayName: '水獭', spritesheetPath: 'spritesheet.webp',
  }), 'utf8')
  writeFileSync(join(assets, 'otter', 'spritesheet.webp'), WEBP_BYTES)
  // Built-in status decoration (M5, #567).
  mkdirSync(join(assets, 'decorations', 'whale'), { recursive: true })
  writeFileSync(join(assets, 'decorations', 'whale', 'decoration.json'), JSON.stringify({
    decorationManifestVersion: 1,
    id: 'whale',
    displayName: '喷水鲸鱼',
    license: 'MIT',
    entry: 'whale-frames.png',
    cell: { width: 64, height: 48 },
    columns: 4,
    frameMs: 140,
    phases: { idle: 'hide', waiting: { from: 0, to: 1 }, thinking: { from: 0, to: 3 } },
  }), 'utf8')
  writeFileSync(join(assets, 'decorations', 'whale', 'whale-frames.png'), WEBP_BYTES)

  const ctx = new Context()
  const registry = loadPetRegistry({ packageRoot: dir, petsDir: '', dshPetsDir: '' })
  service = new PetService(ctx, { persistDir: join(dir, 'home'), registry })
  routes = makePetRoutes({ service, ctx })
  server = createServer((req, res) => {
    const pathname = (req.url ?? '').split('?')[0]!
    for (const route of routes) {
      if (route.kind === 'exact' && pathname === route.path) {
        void route.handler(req, res)
        return
      }
    }
    for (const route of routes) {
      if (route.kind === 'prefix' && (pathname === route.path || pathname.startsWith(route.path + '/'))) {
        void route.handler(req, res)
        return
      }
    }
    res.writeHead(404)
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(dir, { recursive: true, force: true })
})

function url(path: string): string {
  return 'http://127.0.0.1:' + port + path
}

describe('pet routes', () => {
  it('forwards the browser title map to the service', async () => {
    const spy = vi.spyOn(service, 'setSessionTitles')
    const response = await fetch(url('/api/pet/session-titles'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titles: { 's-1': '标题' } }),
    })
    expect(response.status).toBe(200)
    expect(spy).toHaveBeenCalledWith({ 's-1': '标题' }, true, 'legacy')
    spy.mockRestore()
  })

  it('uses the local GUI selection for desktop polls without overriding browser selections', async () => {
    const response = await fetch(url('/api/pet/session-titles'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titles: { 's-1': '项目' }, current: 's-1' }),
    })
    expect(response.status).toBe(200)
    const spy = vi.spyOn(service, 'state')
    await fetch(url('/api/pet/state?desktop=1'))
    expect(spy).toHaveBeenLastCalledWith('s-1')
    await fetch(url('/api/pet/state?current=s-2'))
    expect(spy).toHaveBeenLastCalledWith('s-2')
    await fetch(url('/api/pet/session-titles'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titles: {}, current: null }),
    })
    await fetch(url('/api/pet/state?desktop=1'))
    expect(spy).toHaveBeenLastCalledWith(undefined)
    spy.mockRestore()
  })

  it('keeps remote clients visible and prevents them from replacing the desktop selection', async () => {
    const remoteCtx = {
      get: () => ({ isPairedDevice: () => true }),
    } as unknown as Context
    const ready = vi.fn()
    const remoteRoutes = makePetRoutes({ service, ctx: remoteCtx, overlayReady: ready })
    const remoteServer = createServer((req, res) => {
      // A paired request entering through the public host, rather than loopback authority.
      req.headers.host = 'desktop.example'
      const route = remoteRoutes.find(entry => entry.path === req.url?.split('?')[0])
      if (route) void route.handler(req, res)
      else { res.writeHead(404); res.end() }
    })
    remoteServer.listen(0, '127.0.0.1')
    await once(remoteServer, 'listening')
    const remoteUrl = 'http://127.0.0.1:' + (remoteServer.address() as AddressInfo).port
    service.desktopOverlayRunningProvider = () => true
    service.desktopSessionId = 'local'
    try {
      const rejected = await fetch(remoteUrl + '/api/pet/overlay/ready', { method: 'POST', body: '{}' })
      expect(rejected.status).toBe(403)
      expect(ready).not.toHaveBeenCalled()
      const local = await fetch(url('/api/pet/state')).then(res => res.json())
      expect(local.desktopOverlayRunning).toBe(true)
      const remote = await fetch(remoteUrl + '/api/pet/state').then(res => res.json())
      expect(remote.desktopOverlayRunning).toBeUndefined()
      const selected = await fetch(remoteUrl + '/api/pet/state?surface=desktop').then(res => res.json())
      expect(selected.desktopOverlayRunning).toBe(true)
      await fetch(remoteUrl + '/api/pet/session-titles', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ titles: {}, current: 'remote' }),
      })
      expect(service.desktopSessionId).toBe('local')
    } finally {
      service.desktopOverlayRunningProvider = undefined
      service.desktopSessionId = undefined
      await new Promise<void>(resolve => remoteServer.close(() => resolve()))
    }
  })

  it('calls the companion ready callback', async () => {
    let ready = 0
    const readyCtx = new Context()
    const readyRoutes = makePetRoutes({ service, ctx: readyCtx, overlayReady: () => { ready++ } })
    const readyServer = createServer((req, res) => {
      const pathname = (req.url ?? '').split('?')[0]!
      for (const route of readyRoutes) {
        if (route.kind === 'exact' && pathname === route.path) {
          void route.handler(req, res)
          return
        }
      }
      res.writeHead(404)
      res.end()
    })
    readyServer.listen(0, '127.0.0.1')
    await once(readyServer, 'listening')
    const readyPort = (readyServer.address() as AddressInfo).port
    try {
      const response = await fetch('http://127.0.0.1:' + readyPort + '/api/pet/overlay/ready', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      expect(response.status).toBe(200)
      expect(ready).toBe(1)
    } finally {
      await new Promise<void>((resolve) => readyServer.close(() => resolve()))
    }
  })

  it('orders focus ownership and rejects late snapshots from old UI instances', async () => {
    const ownedRoutes = makePetRoutes({ service, ctx: new Context() })
    const route = ownedRoutes.find(entry => entry.path === '/api/pet/session-titles')!
    const ownedServer = createServer((req, res) => { void route.handler(req, res) })
    ownedServer.listen(0, '127.0.0.1')
    await once(ownedServer, 'listening')
    const endpoint = 'http://127.0.0.1:' + (ownedServer.address() as AddressInfo).port
    const send = async (source: string, revision: number, focusedAt: number, current: string) => {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source, revision, focusedAt, current, titles: { [current]: current } }),
      })
      expect(response.status).toBe(200)
    }
    try {
      await send('a', 10, 10, 'a')
      await send('b', 20, 20, 'b')
      await send('a', 30, 10, 'background-a')
      expect(service.desktopSessionId).toBe('b')
      await send('a', 40, 40, 'a')
      await send('b', 25, 20, 'late-b')
      expect(service.desktopSessionId).toBe('a')
      await send('a', 50, 40, 'replacement')
      await send('a', 45, 40, 'disposed-instance')
      expect(service.desktopSessionId).toBe('replacement')
      // A newer background update from the current owner must not defeat a focus event.
      await send('b', 48, 48, 'focused-b')
      expect(service.desktopSessionId).toBe('focused-b')
      // Coalescing a focus event with a later background snapshot retains ownership.
      await send('a', 70, 60, 'minimized-a')
      await send('a', 60, 60, 'old-a')
      expect(service.desktopSessionId).toBe('minimized-a')
    } finally {
      service.desktopSessionId = undefined
      await new Promise<void>(resolve => ownedServer.close(() => resolve()))
    }
  })

  it('accepts remote and legacy title updates after a local owner has left', async () => {
    const ctx = { get: () => ({ isPairedDevice: () => true }) } as unknown as Context
    const titleRoute = makePetRoutes({ service, ctx }).find(entry => entry.path === '/api/pet/session-titles')!
    const titleServer = createServer((req, res) => {
      if (req.url === '/remote') req.headers.host = 'desktop.example'
      void titleRoute.handler(req, res)
    })
    titleServer.listen(0, '127.0.0.1')
    await once(titleServer, 'listening')
    const endpoint = 'http://127.0.0.1:' + (titleServer.address() as AddressInfo).port
    const spy = vi.spyOn(service, 'setSessionTitles')
    const send = async (path: string, body: unknown) => {
      const response = await fetch(endpoint + path, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      expect(response.status).toBe(200)
    }
    try {
      await send('/local', { source: 'local', revision: 10, focusedAt: 10, current: 'local', titles: { local: 'Local' } })
      // No more updates arrive from the local page, but its ownership record remains.
      await send('/remote', { source: 'phone', revision: 20, focusedAt: 20, current: 'remote', titles: { remote: 'Renamed' } })
      expect(spy).toHaveBeenLastCalledWith({ remote: 'Renamed' }, false, 'remote:phone')
      const remoteCount = spy.mock.calls.length
      await send('/remote', { source: 'phone', revision: 10, focusedAt: 10, titles: { remote: 'Old' } })
      await send('/remote', { source: 'phone', revision: 20, focusedAt: 20, titles: { remote: 'Duplicate' } })
      expect(spy).toHaveBeenCalledTimes(remoteCount)
      expect(service.desktopSessionId).toBe('local')
      await send('/local', { current: 'legacy', titles: { legacy: 'Legacy' } })
      expect(spy).toHaveBeenLastCalledWith({ legacy: 'Legacy' }, true, 'legacy')
      expect(service.desktopSessionId).toBe('local')
      const count = spy.mock.calls.length
      await send('/local', { source: 'local', revision: 9, focusedAt: 9, titles: { local: 'Stale' } })
      expect(spy).toHaveBeenCalledTimes(count)
      // The returning owner supplies a complete snapshot, including deletions.
      await send('/local', { source: 'local', revision: 30, focusedAt: 30, titles: {} })
      expect(spy).toHaveBeenLastCalledWith({}, false, 'local:local')
      await send('/local', { source: 'local', revision: 40, focusedAt: 30, titles: { local: '   ' } })
      expect(spy).toHaveBeenLastCalledWith({ local: '   ' }, false, 'local:local')
      await send('/remote', { source: 'local', revision: 50, focusedAt: 0, release: true })
      expect(service.desktopSessionId).toBe('local')
      await send('/local', { source: 'local', revision: 39, focusedAt: 0, release: true })
      expect(service.desktopSessionId).toBe('local')
      await send('/local', { source: 'local', revision: 50, focusedAt: 0, release: true })
      expect(service.desktopSessionId).toBeUndefined()
      await send('/local', { source: 'local', revision: 49, focusedAt: 40, current: 'late', titles: {} })
      expect(service.desktopSessionId).toBeUndefined()
      await send('/local', { source: 'new', revision: 60, focusedAt: 0, current: 'new', titles: {} })
      expect(service.desktopSessionId).toBe('new')
    } finally {
      spy.mockRestore()
      service.desktopSessionId = undefined
      await new Promise<void>(resolve => titleServer.close(() => resolve()))
    }
  })

  it('lists the registry and the selected state', async () => {
    const pets = await fetch(url('/api/pet/pets')).then(res => res.json()) as Array<{ id: string; atlasUrl: string }>
    expect(pets.map(entry => entry.id)).toEqual(['otter', 'whale-girl'])
    expect(pets.find(entry => entry.id === 'whale-girl')!.atlasUrl).toBe('/pet/whale-girl/spritesheet.webp')

    const state = await fetch(url('/api/pet/state')).then(res => res.json()) as { pet: { id: string }; name: string }
    expect(state.pet.id).toBe('whale-girl')
    expect(state.name).toBe('鲸鱼娘')
  })

  it('accepts the current-session query on the state endpoint', async () => {
    const state = await fetch(url('/api/pet/state?current=s-x')).then(res => res.json()) as { sessions?: unknown[] }
    expect(state.sessions).toEqual([])
  })

  it('serves structured registry diagnostics (#623)', async () => {
    const res = await fetch(url('/api/pet/diagnostics'))
    expect(res.status).toBe(200)
    const body = await res.json() as { diagnostics: Array<{ level: string; source: string; message: string }> }
    expect(Array.isArray(body.diagnostics)).toBe(true)
    // The two fixture pets are v1 manifests: each yields one migration hint.
    const v1Notes = body.diagnostics.filter(d => d.message.includes('treated as renderer'))
    expect(v1Notes.length).toBe(2)
    expect(v1Notes[0]!.level).toBe('warning')
  })

  it('serves the atlas under the pet id and the legacy directory alias', async () => {
    for (const path of ['/pet/whale-girl/spritesheet.webp', '/pet/whale/spritesheet.webp']) {
      const res = await fetch(url(path))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/webp')
      expect(Buffer.from(await res.arrayBuffer())).toEqual(WEBP_BYTES)
    }
  })

  it('revalidates assets with the ETag instead of re-downloading the body', async () => {
    const first = await fetch(url('/pet/whale-girl/spritesheet.webp'))
    expect(first.status).toBe(200)
    const etag = first.headers.get('etag')
    expect(etag).not.toBeNull()
    const cached = await fetch(url('/pet/whale-girl/spritesheet.webp'), {
      headers: { 'if-none-match': etag! },
    })
    expect(cached.status).toBe(304)
    expect(await cached.arrayBuffer()).toHaveProperty('byteLength', 0)
    const stale = await fetch(url('/pet/whale-girl/spritesheet.webp'), {
      headers: { 'if-none-match': '"bogus"' },
    })
    expect(stale.status).toBe(200)
    expect(stale.headers.get('etag')).toBe(etag)
  })

  it('serves the manifest and optional preview media', async () => {
    const manifest = await fetch(url('/pet/whale-girl/pet.json')).then(res => res.json()) as { id: string; spritesheetPath: string }
    expect(manifest.id).toBe('whale-girl')
    expect(manifest.spritesheetPath).toBe('spritesheet.webp')

    const preview = await fetch(url('/pet/whale-girl/previews/idle.gif'))
    expect(preview.status).toBe(200)
    expect(preview.headers.get('content-type')).toBe('image/gif')
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(GIF_BYTES)
  })

  it('answers HEAD on assets and 404s unknown pets and undeclared files', async () => {
    const head = await fetch(url('/pet/whale-girl/spritesheet.webp'), { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-type')).toBe('image/webp')

    expect((await fetch(url('/pet/dragon/spritesheet.webp'))).status).toBe(404)
    expect((await fetch(url('/pet/whale-girl/evil.txt'))).status).toBe(404)
    expect((await fetch(url('/pet/whale-girl/spritesheet.png'))).status).toBe(404)
  })

  it('switches pets and renames per pet through the API', async () => {
    const setPet = await fetch(url('/api/pet/set-pet'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ petId: 'otter' }),
    }).then(res => res.json()) as { ok: boolean }
    expect(setPet.ok).toBe(true)

    const renamed = await fetch(url('/api/pet/set-name'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '阿獭' }),
    }).then(res => res.json()) as { ok: boolean; name: string }
    expect(renamed).toMatchObject({ ok: true, name: '阿獭' })

    const state = await fetch(url('/api/pet/state')).then(res => res.json()) as { pet: { id: string }; name: string }
    expect(state).toMatchObject({ pet: { id: 'otter' }, name: '阿獭' })

    const back = await fetch(url('/api/pet/set-pet'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ petId: 'whale-girl' }),
    }).then(res => res.json()) as { ok: boolean }
    expect(back.ok).toBe(true)
    const whaleState = await fetch(url('/api/pet/state')).then(res => res.json()) as { name: string }
    expect(whaleState.name).toBe('鲸鱼娘')
  })

  it('fences LAN clients out of the API and asset routes', () => {
    const probe = () => {
      let status = 0
      let body = ''
      return {
        res: {
          writeHead: (code: number) => { status = code },
          end: (chunk?: string) => { body = chunk ?? '' },
        },
        status: () => status,
        body: () => body,
      }
    }
    const lanRequest = { method: 'GET', socket: { remoteAddress: '192.168.1.9' }, headers: { host: '192.168.1.9:3080' } }
    const api = probe()
    const apiRoute = routes.find(route => route.kind === 'exact' && route.path === '/api/pet/state')
    apiRoute!.handler(lanRequest as never, api.res as never)
    expect(api.status()).toBe(403)
    expect(api.body()).toContain('loopback-only')

    const asset = probe()
    const assetRoute = routes.find(route => route.kind === 'prefix' && route.path === '/pet')
    assetRoute!.handler({ ...lanRequest, url: '/pet/whale-girl/pet.json' } as never, asset.res as never)
    expect(asset.status()).toBe(403)
    expect(asset.body()).toContain('loopback-only')
  })

  it('allows a LAN client with a live paired-device cookie on API and assets', async () => {
    const probe = () => {
      let status = 0
      let body = ''
      return {
        res: {
          writeHead: (code: number) => { status = code },
          end: (chunk?: string | Buffer) => { body = typeof chunk === 'string' ? chunk : chunk === undefined ? '' : 'ok' },
        },
        status: () => status,
        body: () => body,
      }
    }
    const pairedCtx = { get: () => ({ isPairedDevice: () => true }) }
    const pairedRoutes = makePetRoutes({ service, ctx: pairedCtx as never })
    const lanRequest = {
      method: 'GET',
      socket: { remoteAddress: '192.168.1.9' },
      headers: { host: 'dsh.thinkmoon.cn', cookie: 'dsh_pair=dev-1' },
    }
    const api = probe()
    const apiRoute = pairedRoutes.find(route => route.kind === 'exact' && route.path === '/api/pet/state')
    await apiRoute!.handler(lanRequest as never, api.res as never)
    expect(api.status()).toBe(200)

    const asset = probe()
    const assetRoute = pairedRoutes.find(route => route.kind === 'prefix' && route.path === '/pet')
    await assetRoute!.handler({ ...lanRequest, url: '/pet/whale-girl/pet.json' } as never, asset.res as never)
    expect(asset.status()).toBe(200)
  })
})
describe('decoration routes (pet-center M5, #567)', () => {
  it('serves the strip and descriptor from the declaration allow-list', async () => {
    const strip = await fetch(`http://127.0.0.1:${port}/api/pet/decoration/whale/whale-frames.png`)
    expect(strip.status).toBe(200)
    expect(await strip.arrayBuffer()).toHaveProperty('byteLength', 12)
    const manifest = await fetch(`http://127.0.0.1:${port}/api/pet/decoration/whale/decoration.json`)
    expect(manifest.status).toBe(200)
    expect((await manifest.json()).id).toBe('whale')
  })

  it('refuses files outside the declaration closure', async () => {
    const extra = await fetch(`http://127.0.0.1:${port}/api/pet/decoration/whale/secret.png`)
    expect(extra.status).toBe(404)
    const crafted = await fetch(`http://127.0.0.1:${port}/api/pet/decoration/whale/%2e%2e/whale-frames.png`)
    expect(crafted.status).toBe(404)
  })

  it('404s unknown decoration ids', async () => {
    const missing = await fetch(`http://127.0.0.1:${port}/api/pet/decoration/nope/whale-frames.png`)
    expect(missing.status).toBe(404)
  })

  it('serves the decoration block in the state view', async () => {
    const state = await fetch(`http://127.0.0.1:${port}/api/pet/state`)
    const body = await state.json()
    expect(body.decoration.apiVersion).toBe('x-org.linxin666.pet-center/status-decoration-v1')
    expect(body.decoration.id).toBe('whale')
    expect(body.decoration.entryUrl).toBe('/api/pet/decoration/whale/whale-frames.png')
    expect(body.decoration.phases.thinking).toEqual({ from: 0, to: 3 })
  })

  it('serves the strip and descriptor with correct content types', async () => {
    const strip = await fetch('http://127.0.0.1:' + port + '/api/pet/decoration/whale/whale-frames.png')
    expect(strip.headers.get('content-type')).toBe('image/png')
    const manifest = await fetch('http://127.0.0.1:' + port + '/api/pet/decoration/whale/decoration.json')
    expect(manifest.headers.get('content-type')).toContain('application/json')
  })

  it('answers 405 to POST and 200 with an empty body to HEAD', async () => {
    const post = await fetch('http://127.0.0.1:' + port + '/api/pet/decoration/whale/whale-frames.png', { method: 'POST' })
    expect(post.status).toBe(405)
    const head = await fetch('http://127.0.0.1:' + port + '/api/pet/decoration/whale/whale-frames.png', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.arrayBuffer()).toHaveProperty('byteLength', 0)
  })

  it('revalidates with the ETag instead of re-downloading the strip', async () => {
    const first = await fetch('http://127.0.0.1:' + port + '/api/pet/decoration/whale/whale-frames.png')
    expect(first.status).toBe(200)
    const etag = first.headers.get('etag')
    expect(etag).not.toBeNull()
    const cached = await fetch('http://127.0.0.1:' + port + '/api/pet/decoration/whale/whale-frames.png', {
      headers: { 'if-none-match': etag! },
    })
    expect(cached.status).toBe(304)
    expect(await cached.arrayBuffer()).toHaveProperty('byteLength', 0)
    const stale = await fetch('http://127.0.0.1:' + port + '/api/pet/decoration/whale/whale-frames.png', {
      headers: { 'if-none-match': '"bogus"' },
    })
    expect(stale.status).toBe(200)
  })

  it('enforces the size ceiling and refuses symlink escapes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-pet-deco-caps-'))
    try {
      mkdirSync(join(root, 'assets', 'pet'), { recursive: true })
      writeFileSync(join(root, 'assets', 'pet', 'pet.json'), JSON.stringify({
        id: 'plain-pet', displayName: 'Plain', spritesheetPath: 'spritesheet.webp',
      }), 'utf8')
      writeFileSync(join(root, 'assets', 'pet', 'spritesheet.webp'), WEBP_BYTES)
      const assets = join(root, 'assets', 'decorations', 'whale')
      mkdirSync(assets, { recursive: true })
      writeFileSync(join(assets, 'decoration.json'), JSON.stringify({
        decorationManifestVersion: 1,
        id: 'whale',
        license: 'MIT',
        entry: 'whale-frames.png',
        cell: { width: 64, height: 48 },
        columns: 4,
        phases: { thinking: { from: 0, to: 3 } },
      }), 'utf8')
      writeFileSync(join(assets, 'whale-frames.png'), Buffer.alloc(128, 1))
      const ctx = new Context()
      const registry = loadPetRegistry({ packageRoot: root, petsDir: '', dshPetsDir: '' })
      const capped = new PetService(ctx, { persistDir: join(root, 'home'), registry })
      const tinyRoutes = makePetRoutes({ service: capped, ctx, assetCaps: { manifest: 64, image: 64, model: 64 } })
      const srv = createServer((req, res) => {
        const pathname = (req.url ?? '').split('?')[0]!
        for (const route of tinyRoutes) {
          if (route.kind === 'exact' && pathname === route.path) { void route.handler(req, res); return }
        }
        for (const route of tinyRoutes) {
          if (route.kind === 'prefix' && (pathname === route.path || pathname.startsWith(route.path + '/'))) { void route.handler(req, res); return }
        }
        res.writeHead(404)
        res.end()
      })
      srv.listen(0, '127.0.0.1')
      await once(srv, 'listening')
      try {
        const capPort = (srv.address() as AddressInfo).port
        const oversized = await fetch('http://127.0.0.1:' + capPort + '/api/pet/decoration/whale/whale-frames.png')
        expect(oversized.status).toBe(413)
        // A strip symlinked outside the decoration directory is refused.
        rmSync(join(assets, 'whale-frames.png'))
        const outside = join(root, 'outside.png')
        writeFileSync(outside, Buffer.alloc(4, 1))
        symlinkSync(outside, join(assets, 'whale-frames.png'))
        const escaped = await fetch('http://127.0.0.1:' + capPort + '/api/pet/decoration/whale/whale-frames.png')
        expect(escaped.status).toBe(403)
      } finally {
        await new Promise<void>((resolve) => srv.close(() => resolve()))
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
describe('runtime routes', () => {
  it('revalidates runtime files with the ETag instead of re-downloading', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-pet-runtime-'))
    try {
      const runtimeDir = join(root, '.runtime')
      const vendorDir = join(root, 'lib')
      mkdirSync(runtimeDir, { recursive: true })
      mkdirSync(vendorDir, { recursive: true })
      writeFileSync(join(runtimeDir, 'live2dcubismcore.min.js'), 'core()', 'utf8')
      writeFileSync(join(vendorDir, 'live2d-vendor.js'), 'vendor()', 'utf8')
      const ctx = new Context()
      const runtimeRoutes = makePetRoutes({
        service, ctx, runtimeDir, vendorDir,
      })
      const srv = createServer((req, res) => {
        const pathname = (req.url ?? '').split('?')[0]!
        for (const route of runtimeRoutes) {
          if (route.kind === 'prefix' && (pathname === route.path || pathname.startsWith(route.path + '/'))) {
            void route.handler(req, res)
            return
          }
        }
        res.writeHead(404)
        res.end()
      })
      srv.listen(0, '127.0.0.1')
      await once(srv, 'listening')
      try {
        const runtimePort = (srv.address() as AddressInfo).port
        for (const name of ['live2dcubismcore.min.js', 'live2d-vendor.js']) {
          const base = 'http://127.0.0.1:' + runtimePort + '/api/pet/runtime/' + name
          const first = await fetch(base)
          expect(first.status).toBe(200)
          const etag = first.headers.get('etag')
          expect(etag).not.toBeNull()
          const cached = await fetch(base, { headers: { 'if-none-match': etag! } })
          expect(cached.status).toBe(304)
          expect(await cached.arrayBuffer()).toHaveProperty('byteLength', 0)
          const stale = await fetch(base, { headers: { 'if-none-match': '"nope"' } })
          expect(stale.status).toBe(200)
        }
      } finally {
        await new Promise<void>((resolve) => srv.close(() => resolve()))
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('post body failure contract (shared readJsonBody migration)', () => {  it('accepts a valid JSON object body through the shared reader', async () => {
    const res = await fetch(url('/api/pet/interact'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'pet' }),
    })
    expect(res.status).toBe(200)
  })

  it('answers 400 with the endpoint validator for a body that is not JSON', async () => {
    const res = await fetch(url('/api/pet/interact'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, error: 'invalid-kind' })
  })

  it('writes family JSON headers through the shared writer', async () => {
    const res = await fetch(url('/api/pet/interact'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('preserves the empty-body {} pipeline through the call site', async () => {
    const res = await fetch(url('/api/pet/set-config'), { method: 'POST' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
  })

  it('destroys the connection on an over-limit body instead of answering JSON', async () => {
    await expect(fetch(url('/api/pet/interact'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"pad":"' + 'x'.repeat(64 * 1024) + '"}',
    })).rejects.toThrow()
  })
})
