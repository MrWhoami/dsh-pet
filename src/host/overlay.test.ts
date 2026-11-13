import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  DesktopOverlay,
  companionSupportsReady,
  overlayCandidates,
  overlaySpawnSpec,
  resolveOverlayCommand,
  type OverlayChild,
} from './overlay.ts'

/** A child process stand-in that records kill() and can emit exit/error. */
class FakeChild extends EventEmitter {
  pid: number | undefined = 4321
  killed = false

  kill(): boolean {
    this.killed = true
    this.emit('exit', 0, null)
    return true
  }
}

/** Build one launcher over a fixed install. */
function launcher(overrides: {
  exists?: (path: string) => boolean
  readFile?: (path: string) => string
  hashFile?: (path: string) => string
  child?: FakeChild
  platform?: NodeJS.Platform
} = {}) {
  const child = overrides.child ?? new FakeChild()
  const spawn = vi.fn(() => child as unknown as OverlayChild)
  const overlay = new DesktopOverlay({
    home: join('C:', 'home'),
    packageRoot: join('C:', 'pkg'),
    platform: overrides.platform ?? 'win32',
    exists: overrides.exists ?? (() => false),
    readFile: overrides.readFile ?? (() => JSON.stringify({ protocol: 2, sha256: 'a'.repeat(64), managedSha256: 'a'.repeat(64) })),
    hashFile: overrides.hashFile ?? (() => 'a'.repeat(64)),
    spawn,
  })
  return { overlay, child, spawn }
}

describe('overlayCandidates', () => {
  it('prefers the user runtime install over the package and development locations', () => {
    const candidates = overlayCandidates(join('C:', 'home'), join('C:', 'pkg'))
    expect(candidates[0]).toBe(join('C:', 'home', 'pets', '.runtime', 'DshPetOverlay.exe'))
    expect(candidates).toContain(join('C:', 'pkg', 'experiments', 'desktop-overlay', 'bin', 'Release', 'net8.0-windows', 'DshPetOverlay.exe'))
  })
})

describe('companionSupportsReady', () => {
  it('rejects a marker after the managed companion DLL is replaced', () => {
    const exe = join('C:', 'overlay', 'DshPetOverlay.exe')
    const marker = JSON.stringify({ protocol: 2, sha256: 'a'.repeat(64), managedSha256: 'b'.repeat(64) })
    expect(companionSupportsReady(exe, () => marker, () => 'a'.repeat(64))).toBe(false)
    expect(companionSupportsReady(exe, () => marker, path => path.endsWith('.dll') ? 'b'.repeat(64) : 'a'.repeat(64))).toBe(true)
  })
  it('reads and hash-binds the protocol marker next to the program', () => {
    const exe = join('C:', 'overlay', 'DshPetOverlay.exe')
    const reads: string[] = []
    const marker = JSON.stringify({ protocol: 2, sha256: 'a'.repeat(64), managedSha256: 'a'.repeat(64) })
    expect(companionSupportsReady(exe, path => { reads.push(path); return marker }, () => 'a'.repeat(64))).toBe(true)
    expect(reads[0]).toBe(join('C:', 'overlay', 'companion.protocol'))
    expect(companionSupportsReady(exe, () => { throw new Error('missing') })).toBe(false)
    expect(companionSupportsReady(exe, () => 'nope')).toBe(false)
    expect(companionSupportsReady(exe, () => marker, () => 'b'.repeat(64))).toBe(false)
    expect(companionSupportsReady(exe, () => JSON.stringify({ protocol: 2, sha256: 'a'.repeat(64) }), () => 'a'.repeat(64))).toBe(false)
  })
})

describe('resolveOverlayCommand', () => {
  it('uses an explicit profile path when it exists', () => {
    const explicit = join('D:', 'tools', 'DshPetOverlay.exe')
    const resolved = resolveOverlayCommand({
      explicit,
      home: join('C:', 'home'),
      packageRoot: join('C:', 'pkg'),
      exists: path => path === explicit,
    })
    expect(resolved).toEqual({ command: explicit, expectedPath: explicit, found: true })
  })

  it('uses the first existing candidate when nothing is explicit', () => {
    const runtime = join('C:', 'home', 'pets', '.runtime', 'DshPetOverlay.exe')
    const resolved = resolveOverlayCommand({
      home: join('C:', 'home'),
      packageRoot: join('C:', 'pkg'),
      exists: path => path === runtime,
    })
    expect(resolved.command).toBe(runtime)
    expect(resolved.found).toBe(true)
  })

  it('reports the preferred path when nothing is installed', () => {
    const expected = join('C:', 'home', 'pets', '.runtime', 'DshPetOverlay.exe')
    const resolved = resolveOverlayCommand({
      home: join('C:', 'home'),
      packageRoot: join('C:', 'pkg'),
      exists: () => false,
    })
    expect(resolved).toEqual({ command: expected, expectedPath: expected, found: false })
  })

  it('does not fall back to a different install when the explicit path is missing', () => {
    const explicit = join('D:', 'tools', 'DshPetOverlay.exe')
    const runtime = join('C:', 'home', 'pets', '.runtime', 'DshPetOverlay.exe')
    const resolved = resolveOverlayCommand({
      explicit,
      home: join('C:', 'home'),
      packageRoot: join('C:', 'pkg'),
      exists: path => path === runtime,
    })
    expect(resolved).toEqual({ command: explicit, expectedPath: explicit, found: false })
  })
})

describe('overlaySpawnSpec', () => {
  it('passes the host origin, parent pid and host protocol to the executable', () => {
    expect(overlaySpawnSpec('C:\\pet\\DshPetOverlay.exe', 'http://127.0.0.1:1234', 99)).toEqual({
      command: 'C:\\pet\\DshPetOverlay.exe',
      args: ['--base', 'http://127.0.0.1:1234', '--parent-pid', '99', '--host-protocol', '2'],
    })
  })
})

describe('DesktopOverlay', () => {
  it('spawns the companion with the host origin and parent pid', () => {
    const runtime = join('C:', 'home', 'pets', '.runtime', 'DshPetOverlay.exe')
    const { overlay, spawn } = launcher({ exists: path => path === runtime })
    overlay.sync({ enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    expect(spawn).toHaveBeenCalledWith(
      runtime,
      ['--base', 'http://127.0.0.1:1234', '--parent-pid', '99', '--host-protocol', '2'],
      { stdio: 'ignore', windowsHide: true },
    )
    expect(overlay.status()).toMatchObject({ supported: true, running: true, pid: 4321, command: runtime })
  })

  it('does not spawn twice while a child is running', () => {
    const runtime = join('C:', 'home', 'pets', '.runtime', 'DshPetOverlay.exe')
    const { overlay, spawn } = launcher({ exists: path => path === runtime })
    overlay.sync({ enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    overlay.sync({ enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('reports a missing program instead of spawning', () => {
    const { overlay, spawn } = launcher({ exists: () => false })
    overlay.sync({ enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    expect(spawn).not.toHaveBeenCalled()
    expect(overlay.status()).toMatchObject({ running: false, error: 'overlay-not-installed' })
  })

  it('stops the child when disabled', () => {
    const runtime = join('C:', 'home', 'pets', '.runtime', 'DshPetOverlay.exe')
    const { overlay, child } = launcher({ exists: path => path === runtime })
    overlay.sync({ enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    overlay.sync({ enabled: false, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    expect(child.killed).toBe(true)
    expect(overlay.status()).toMatchObject({ running: false })
  })

  it('turns a non-zero exit into a status error', () => {
    const runtime = join('C:', 'home', 'pets', '.runtime', 'DshPetOverlay.exe')
    const { overlay, child } = launcher({ exists: path => path === runtime })
    overlay.sync({ enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    child.emit('exit', 1, null)
    expect(overlay.status()).toMatchObject({ running: false, error: 'overlay-exited' })
  })

  it.each([[2, 'overlay-unsupported-pet'], [3, 'overlay-start-failed']] as const)('classifies companion exit %s', (code: number, error: string) => {
    const { overlay, child } = launcher({ exists: () => true })
    overlay.sync({ enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    child.emit('exit', code, null)
    expect(overlay.status()).toMatchObject({ running: false, ready: false, dismissed: true, error })
  })

  it('leaves a clean exit without an error', () => {
    const runtime = join('C:', 'home', 'pets', '.runtime', 'DshPetOverlay.exe')
    const { overlay, child } = launcher({ exists: path => path === runtime })
    overlay.sync({ enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    child.emit('exit', 0, null)
    expect(overlay.status()).toMatchObject({ running: false, dismissed: true })
    expect(overlay.status().error).toBeUndefined()
  })

  it('treats a companion without a protocol marker as legacy-ready', () => {
    const runtime = join('C:', 'home', 'pets', '.runtime', 'DshPetOverlay.exe')
    const { overlay } = launcher({
      exists: path => path === runtime,
      readFile: () => { throw new Error('no marker') },
    })
    overlay.sync({ enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    expect(overlay.status()).toMatchObject({ running: true, ready: true })
    expect(overlay.status().error).toBeUndefined()
  })

  it('marks ready only after the companion reports it', () => {
    const runtime = join('C:', 'home', 'pets', '.runtime', 'DshPetOverlay.exe')
    const { overlay, child } = launcher({ exists: path => path === runtime })
    overlay.sync({ enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    expect(overlay.status()).toMatchObject({ running: true, ready: false })
    overlay.markReady()
    expect(overlay.status()).toMatchObject({ running: true, ready: true })
    child.emit('exit', 0, null)
    expect(overlay.status()).toMatchObject({ running: false, ready: false })
  })

  it('does not restart after a clean user close until the switch is cycled', () => {
    const runtime = join('C:', 'home', 'pets', '.runtime', 'DshPetOverlay.exe')
    const { overlay, child, spawn } = launcher({ exists: path => path === runtime })
    overlay.sync({ enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    child.emit('exit', 0, null)
    overlay.sync({ enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    expect(spawn).toHaveBeenCalledTimes(1)
    overlay.sync({ enabled: false, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    overlay.sync({ enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('keeps running until the killed process actually exits', () => {
    const runtime = join('C:', 'home', 'pets', '.runtime', 'DshPetOverlay.exe')
    const { overlay, child } = launcher({ exists: path => path === runtime })
    overlay.sync({ enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    child.kill = () => { child.killed = true; return true }
    overlay.sync({ enabled: false, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    expect(child.killed).toBe(true)
    expect(overlay.status()).toMatchObject({ running: true })
    child.emit('exit', 0, null)
    expect(overlay.status()).toMatchObject({ running: false })
  })

  it('restarts after re-enabling while the old child is still exiting', () => {
    const { overlay, child, spawn } = launcher({ exists: () => true })
    const config = { enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 }
    child.kill = () => true
    overlay.sync(config)
    overlay.sync({ ...config, enabled: false })
    overlay.sync(config)
    expect(spawn).toHaveBeenCalledTimes(1)
    child.emit('exit', 0, null)
    expect(spawn).toHaveBeenCalledTimes(2)
    overlay.dispose()
    child.emit('exit', 0, null)
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('retains a live child through repeated kill errors and retries disposal', () => {
    const { overlay, child } = launcher({ exists: () => true })
    const config = { enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 }
    overlay.sync(config)
    overlay.markReady()
    const kill = vi.fn(() => {
      child.emit('error', Object.assign(new Error('kill EPERM'), { syscall: 'kill' }))
      return false
    })
    child.kill = kill
    overlay.sync({ ...config, enabled: false })
    expect(overlay.status()).toMatchObject({ running: true, ready: true, error: 'overlay-stop-failed' })
    overlay.dispose()
    expect(kill).toHaveBeenCalledTimes(2)
    expect(overlay.status()).toMatchObject({ running: true, ready: true })
    child.kill = () => { child.emit('exit', 0, null); return true }
    overlay.dispose()
    expect(overlay.status()).toMatchObject({ running: false, ready: false })
    expect(overlay.status().error).toBeUndefined()
  })

  it('clears a failed spawn that never acquired a pid', () => {
    const child = new FakeChild()
    child.pid = undefined
    const { overlay } = launcher({ exists: () => true, child })
    overlay.sync({ enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    child.emit('error', new Error('spawn ENOENT'))
    expect(overlay.status()).toMatchObject({ running: false, ready: false, dismissed: true, error: 'spawn-failed: spawn ENOENT' })
  })

  it('retries a pending re-enable after an asynchronous spawn failure', () => {
    const child = new FakeChild()
    child.pid = undefined
    const { overlay, spawn } = launcher({ exists: () => true, child })
    child.kill = () => false
    const config = { enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 }
    overlay.sync(config)
    overlay.sync({ ...config, enabled: false })
    overlay.sync(config)
    child.emit('error', new Error('spawn failed'))
    expect(spawn).toHaveBeenCalledTimes(2)
    child.emit('error', new Error('spawn failed again'))
    expect(overlay.status()).toMatchObject({ running: false, dismissed: true })
  })

  it.each(['false', 'throw'])('retains the child when kill returns %s without an error event', (failure: string) => {
    const { overlay, child } = launcher({ exists: () => true })
    overlay.sync({ enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    overlay.markReady()
    child.kill = () => {
      if (failure === 'throw') throw new Error('kill denied')
      return false
    }
    overlay.dispose()
    expect(overlay.status()).toMatchObject({ running: true, ready: true, error: 'overlay-stop-failed' })
    child.emit('exit', 0, null)
    expect(overlay.status()).toMatchObject({ running: false, ready: false })
  })

  it.each([
    ['http://0.0.0.0:3080', 'http://127.0.0.1:3080'],
    ['http://[::]:3080', 'http://[::1]:3080'],
  ])('uses loopback for a wildcard listener %s', (baseUrl, expected) => {
    const { overlay, spawn } = launcher({ exists: () => true })
    try {
      overlay.sync({ enabled: true, baseUrl, parentPid: 99 })
      expect(spawn).toHaveBeenCalledWith(expect.any(String),
        ['--base', expected, '--parent-pid', '99', '--host-protocol', '2'],
        { stdio: 'ignore', windowsHide: true })
    } finally {
      overlay.dispose()
    }
  })

  it.each(['http://192.168.1.10:3080', 'invalid', 'file:///tmp/pet'])('rejects an unreachable companion origin %s before spawning', (baseUrl: string) => {
    const { overlay, spawn } = launcher({ exists: () => true })
    overlay.sync({ enabled: true, baseUrl, parentPid: 99 })
    expect(spawn).not.toHaveBeenCalled()
    expect(overlay.status()).toMatchObject({ running: false, error: 'overlay-loopback-required' })
  })

  it.each(['http://127.0.0.2:3080', 'http://[::1]:3080', 'https://localhost:3080'])('accepts a loopback companion origin %s', (baseUrl: string) => {
    const { overlay, spawn } = launcher({ exists: () => true })
    overlay.sync({ enabled: true, baseUrl, parentPid: 99 })
    expect(spawn).toHaveBeenCalledTimes(1)
    overlay.dispose()
  })

  it('rejects script wrappers that could outlive their parent', () => {
    const script = join('C:', 'pet', 'overlay.ps1')
    const { overlay, spawn } = launcher({ exists: path => path === script })
    overlay.sync({ enabled: true, command: script, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    expect(spawn).not.toHaveBeenCalled()
    expect(overlay.status()).toMatchObject({ running: false, error: 'overlay-unsupported-command' })
  })

  it('stops and reports a timeout when the companion never reports ready', () => {
    vi.useFakeTimers()
    try {
      const runtime = join('C:', 'home', 'pets', '.runtime', 'DshPetOverlay.exe')
      const { overlay, child } = launcher({ exists: path => path === runtime })
      overlay.sync({ enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
      vi.advanceTimersByTime(15_000)
      expect(child.killed).toBe(true)
      expect(overlay.status()).toMatchObject({ running: false, ready: false, error: 'overlay-timeout' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports spawn failures', () => {
    const runtime = join('C:', 'home', 'pets', '.runtime', 'DshPetOverlay.exe')
    const spawn = vi.fn(() => { throw new Error('denied') })
    const overlay = new DesktopOverlay({
      home: join('C:', 'home'),
      packageRoot: join('C:', 'pkg'),
      platform: 'win32',
      exists: path => path === runtime,
      spawn,
    })
    overlay.sync({ enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    expect(overlay.status()).toMatchObject({ error: 'spawn-failed: denied' })
  })

  it('reports an empty origin instead of spawning', () => {
    const runtime = join('C:', 'home', 'pets', '.runtime', 'DshPetOverlay.exe')
    const { overlay, spawn } = launcher({ exists: path => path === runtime })
    overlay.sync({ enabled: true, baseUrl: '', parentPid: 99 })
    expect(spawn).not.toHaveBeenCalled()
    expect(overlay.status()).toMatchObject({ error: 'overlay-no-base-url' })
  })

  it('is a no-op on a platform without a companion', () => {
    const { overlay, spawn } = launcher({ exists: () => true, platform: 'darwin' })
    overlay.sync({ enabled: true, baseUrl: 'http://127.0.0.1:1234', parentPid: 99 })
    expect(spawn).not.toHaveBeenCalled()
    expect(overlay.status()).toMatchObject({ supported: false, running: false })
  })
})
