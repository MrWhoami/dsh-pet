/**
 * Desktop companion launcher. The browser half can only draw inside the
 * client's web contents, so a pet that must survive client-window
 * minimization lives in its own top-level window. That window is a separate
 * program (`DshPetOverlay`); this module owns its lifecycle: find the program,
 * spawn it with the host origin, wait until it reports ready, and stop it when
 * the plugin is disabled or disposed. It never downloads an executable; an
 * install puts the program under `$DSH_HOME/pets/.runtime/` (or a profile
 * config points at a build).
 * @module @linxin666/dsh-pet/host/overlay
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import { isLoopbackHostname } from '../loopback.ts'

/** How long the companion has to report ready before it is treated as broken. */
const READY_TIMEOUT_MS = 15_000

/** Companion protocol that introduced the ready handshake. */
const COMPANION_PROTOCOL = 2

/** Host protocol advertised to the companion so it can distinguish a legacy Host from a broken current one. */
const HOST_PROTOCOL = 2

/** The subset of a child process the launcher needs (a test seam). */
export interface OverlayChild {
  /** Process id while running. */
  readonly pid?: number
  /** Signal the process; Node runs TerminateProcess on Windows regardless of the signal name. */
  kill(signal?: NodeJS.Signals): boolean
  /** Subscribe to one event. */
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  /** Subscribe to one error. */
  once(event: 'error', listener: (error: Error) => void): this
}

/** Spawn implementation the launcher uses (injectable for tests). */
export type OverlaySpawn = (
  command: string,
  args: readonly string[],
  options: { stdio: 'ignore'; windowsHide: boolean },
) => OverlayChild

/** What the launcher needs to know about its installation. */
export interface DesktopOverlayDeps {
  /** Harness home; the companion install directory lives under it. */
  home: string
  /** Package root, used for the shipped location and the in-repo development build. */
  packageRoot: string
  /** Operating-system platform; defaults to the running process. */
  platform?: NodeJS.Platform
  /** File-existence probe; defaults to `existsSync`. */
  exists?: (path: string) => boolean
  /** Text reader for the companion protocol marker; defaults to `readFileSync`. */
  readFile?: (path: string) => string
  /** SHA-256 of a file, used to bind the protocol marker to the executable. */
  hashFile?: (path: string) => string
  /** Spawn implementation; defaults to `node:child_process.spawn`. */
  spawn?: OverlaySpawn
}

/** One settings-driven launch request. */
export interface OverlayLaunch {
  /** Master switch: true starts the companion when it is not running. */
  enabled: boolean
  /** Explicit program path from the profile config; empty uses discovery. */
  command?: string
  /** Origin of the running host, e.g. `http://127.0.0.1:3080`. */
  baseUrl: string
  /** The host's pid; the companion exits when this process is gone. */
  parentPid: number
}

/** Public status the settings card and the `/api/pet/overlay` route read. */
export interface OverlayStatus {
  /** Whether the platform can host the companion (Windows today). */
  supported: boolean
  /** Whether the launcher owns a live child process. */
  running: boolean
  /** Whether the companion has loaded its first frame and reported ready. */
  ready: boolean
  /** True after a user close/hide, crash or ready timeout; the switch must be cycled. */
  dismissed: boolean
  /** Child process id while running. */
  pid?: number
  /** Program path in use, or the preferred path when nothing was found. */
  command?: string
  /** The install path the launcher looked for first. */
  expectedPath?: string
  /** Machine-readable failure: `overlay-not-installed`, `spawn-failed`, `overlay-exited`, ... */
  error?: string
}

/** Candidate install locations, most specific first. */
export function overlayCandidates(home: string, packageRoot: string): string[] {
  return [
    // A user-installed/published companion. The plugin ships no executable;
    // this is where an install/unpack step puts one.
    join(home, 'pets', '.runtime', 'DshPetOverlay.exe'),
    join(home, 'pets', '.runtime', 'dsh-pet-overlay', 'DshPetOverlay.exe'),
    // A package that bundles the built companion (not the public tarball).
    join(packageRoot, 'lib', 'overlay', 'win-x64', 'DshPetOverlay.exe'),
    // In-repo development build from `experiments/desktop-overlay`.
    join(packageRoot, 'experiments', 'desktop-overlay', 'bin', 'Release', 'net8.0-windows', 'DshPetOverlay.exe'),
    join(packageRoot, 'experiments', 'desktop-overlay', 'bin', 'Debug', 'net8.0-windows', 'DshPetOverlay.exe'),
  ]
}

/** The command chosen for one launch plus whether it exists. */
export interface ResolvedOverlayCommand {
  /** Program path (or the preferred path when nothing exists). */
  command: string
  /** The path discovery looked at first, for the "not installed" hint. */
  expectedPath: string
  /** Whether `command` exists on disk. */
  found: boolean
}

/**
 * Resolve the companion program. An explicit profile path is authoritative:
 * if it is set but missing, the launcher reports that path instead of silently
 * running some other installation. Without an explicit path the first existing
 * candidate is used; a missing program keeps the preferred candidate in
 * `command` so the status can tell the reader where to install it.
 */
export function resolveOverlayCommand(options: {
  explicit?: string
  home: string
  packageRoot: string
  exists?: (path: string) => boolean
}): ResolvedOverlayCommand {
  const exists = options.exists ?? existsSync
  const explicit = options.explicit?.trim()
  if (explicit !== undefined && explicit !== '') {
    return { command: explicit, expectedPath: explicit, found: exists(explicit) }
  }
  const candidates = overlayCandidates(options.home, options.packageRoot)
  for (const candidate of candidates) {
    if (exists(candidate)) return { command: candidate, expectedPath: candidate, found: true }
  }
  const expectedPath = candidates[0]!
  return { command: expectedPath, expectedPath, found: false }
}

/**
 * Whether the installed companion understands the ready handshake. The marker
 * is a JSON `{protocol, sha256, managedSha256}` written at build time and
 * bound to the executable and managed DLL, so a stale marker beside an older build is
 * not trusted. A companion without a valid marker is treated as legacy
 * (running is enough to hide the page pet), so upgrading the Host alone cannot
 * turn every start into a 15 s timeout flash.
 */
export function companionSupportsReady(
  command: string,
  readFile: (path: string) => string = path => readFileSync(path, 'utf8'),
  hashFile: (path: string) => string = path => createHash('sha256').update(readFileSync(path)).digest('hex'),
): boolean {
  try {
    const marker = JSON.parse(readFile(join(dirname(command), 'companion.protocol'))) as {
      protocol?: unknown
      sha256?: unknown
      managedSha256?: unknown
    }
    if (typeof marker.protocol !== 'number' || marker.protocol < COMPANION_PROTOCOL) return false
    if (typeof marker.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(marker.sha256)) return false
    if (marker.sha256.toLowerCase() !== hashFile(command).toLowerCase()) return false
    if (typeof marker.managedSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(marker.managedSha256)) return false
    const managedPath = join(dirname(command), parse(command).name + '.dll')
    return marker.managedSha256.toLowerCase() === hashFile(managedPath).toLowerCase()
  } catch {
    return false
  }
}

/**
 * Build the spawn command for one program path. The companion is executed
 * directly; script wrappers are rejected by the launcher because a PowerShell/
 * cmd parent cannot be trusted to terminate the real companion (and
 * `-ExecutionPolicy Bypass` is not something this plugin should enable).
 */
export function overlaySpawnSpec(
  command: string,
  baseUrl: string,
  parentPid: number,
): { command: string; args: string[] } {
  return { command, args: ['--base', baseUrl, '--parent-pid', String(parentPid), '--host-protocol', String(HOST_PROTOCOL)] }
}

/** True for wrappers whose child process would outlive a parent kill. */
function isScriptWrapper(command: string): boolean {
  return /\.(?:ps1|cmd|bat)$/i.test(command)
}

/** Owns the companion process for one plugin fiber. */
export class DesktopOverlay {
  private readonly deps: DesktopOverlayDeps
  private readonly supported: boolean
  private child: OverlayChild | undefined
  private command: string | undefined
  private expectedPath: string | undefined
  private error: string | undefined
  private ready = false
  private dismissed = false
  private stopping = false
  private stopError: string | undefined
  private readyTimer: NodeJS.Timeout | undefined
  private latestLaunch: OverlayLaunch | undefined

  constructor(deps: DesktopOverlayDeps) {
    this.deps = deps
    this.supported = (deps.platform ?? process.platform) === 'win32'
  }

  /** Current status; safe to call from any route or settings refresh. */
  status(): OverlayStatus {
    return {
      supported: this.supported,
      running: this.child !== undefined,
      ready: this.ready,
      dismissed: this.dismissed,
      ...(this.child?.pid === undefined ? {} : { pid: this.child.pid }),
      ...(this.command === undefined ? {} : { command: this.command }),
      ...(this.expectedPath === undefined ? {} : { expectedPath: this.expectedPath }),
      ...(this.error === undefined ? {} : { error: this.error }),
    }
  }

  /**
   * The companion calls the host's `/api/pet/overlay/ready` route after it has
   * loaded the atlas and displayed its first frame. Only then may the page
   * sprite hide, so a broken or still-starting companion never leaves the user
   * with no pet at all.
   */
  markReady(): void {
    if (this.child === undefined || this.stopping) return
    this.ready = true
    this.clearReadyTimer()
  }

  /**
   * Apply one launch request. Disabled stops the companion; an enabled request
   * starts it when no child is running. A user close (or a crash) marks the
   * companion dismissed, so unrelated settings updates do not restart it; the
   * user explicitly turns the switch off and on to start it again.
   */
  sync(config: OverlayLaunch): void {
    this.latestLaunch = config
    if (!this.supported) return
    if (!config.enabled) {
      this.dismissed = false
      this.error = undefined
      this.stop()
      return
    }
    if (this.dismissed) return
    if (this.child !== undefined) return
    if (config.baseUrl === '') {
      this.error = 'overlay-no-base-url'
      return
    }
    let baseUrl: string
    try {
      const origin = new URL(config.baseUrl)
      // Wildcard listeners include loopback; keep LAN access on the Host while
      // the companion uses an address accepted by the local API guard.
      if (origin.hostname === '0.0.0.0') origin.hostname = '127.0.0.1'
      else if (origin.hostname === '[::]') origin.hostname = '[::1]'
      if (!['http:', 'https:'].includes(origin.protocol) || !isLoopbackHostname(origin.hostname)) {
        this.error = 'overlay-loopback-required'
        return
      }
      baseUrl = origin.origin
    } catch {
      this.error = 'overlay-loopback-required'
      return
    }
    const resolved = resolveOverlayCommand({
      explicit: config.command,
      home: this.deps.home,
      packageRoot: this.deps.packageRoot,
      exists: this.deps.exists,
    })
    this.command = resolved.command
    this.expectedPath = resolved.expectedPath
    if (!resolved.found) {
      this.error = 'overlay-not-installed'
      return
    }
    if (isScriptWrapper(resolved.command)) {
      this.error = 'overlay-unsupported-command'
      return
    }
    const spec = overlaySpawnSpec(resolved.command, baseUrl, config.parentPid)
    const supportsReady = companionSupportsReady(resolved.command, this.deps.readFile, this.deps.hashFile)
    const spawn = this.deps.spawn ?? (nodeSpawn as unknown as OverlaySpawn)
    try {
      const child = spawn(spec.command, spec.args, { stdio: 'ignore', windowsHide: true })
      this.child = child
      // Legacy companions have no ready route; their window is visible as soon
      // as the process survives, so treat them as ready to avoid the timeout
      // flash. New companions must prove the first frame before the page hides.
      this.ready = !supportsReady
      this.error = undefined
      this.dismissed = false
      this.stopping = false
      this.stopError = undefined
      if (supportsReady) this.armReadyTimer(child)
      child.once('exit', (code) => {
        if (this.child !== child) return
        const deliberate = this.stopping
        const stopError = this.stopError
        this.child = undefined
        this.ready = false
        this.stopping = false
        this.stopError = undefined
        this.clearReadyTimer()
        this.error = stopError ?? (deliberate || code === 0 || code === null ? undefined
          : code === 2 ? 'overlay-unsupported-pet' : code === 3 ? 'overlay-start-failed' : 'overlay-exited')
        // A deliberate stop keeps the dismissed flag chosen by the caller; a
        // user close or crash means "do not silently start again".
        if (!deliberate) this.dismissed = true
        if (deliberate && this.latestLaunch?.enabled) this.sync(this.latestLaunch)
      })
      const onError = (error: Error): void => {
        if (this.child !== child) return
        // Node also emits `error` when kill() fails. A child with a pid was
        // spawned successfully and remains owned until its exit event.
        if (child.pid !== undefined) {
          this.error = this.stopError ?? 'overlay-stop-failed'
          child.once('error', onError)
          return
        }
        const deliberate = this.stopping
        const stopError = this.stopError
        this.child = undefined
        this.ready = false
        this.stopping = false
        this.stopError = undefined
        this.clearReadyTimer()
        this.error = stopError ?? (deliberate ? undefined : 'spawn-failed: ' + error.message)
        if (!deliberate) this.dismissed = true
        if (deliberate && this.latestLaunch?.enabled) this.sync(this.latestLaunch)
      }
      child.once('error', onError)
    } catch (error) {
      this.child = undefined
      this.ready = false
      this.error = 'spawn-failed: ' + (error instanceof Error ? error.message : String(error))
      this.dismissed = true
    }
  }

  /** Stop the companion; the plugin fiber calls this on dispose. */
  dispose(): void {
    this.latestLaunch = undefined
    this.stop()
  }

  private stop(error?: string): void {
    const child = this.child
    if (child === undefined) {
      this.ready = false
      this.clearReadyTimer()
      this.error = error
      return
    }
    // Keep the current ready/running state until the process actually exits:
    // a failed kill must not make the page pet return while the companion is
    // still on screen.
    this.stopping = true
    this.stopError = error
    this.error = error
    this.clearReadyTimer()
    try {
      if (!child.kill() && this.child === child) this.error = error ?? 'overlay-stop-failed'
    } catch {
      // Keep `running` true; a later sync/stop retries the kill.
      this.error = error ?? 'overlay-stop-failed'
    }
  }

  private armReadyTimer(child: OverlayChild): void {
    this.clearReadyTimer()
    const timer = setTimeout(() => {
      if (this.child !== child || this.ready) return
      this.dismissed = true
      this.stop('overlay-timeout')
    }, READY_TIMEOUT_MS)
    timer.unref?.()
    this.readyTimer = timer
  }

  private clearReadyTimer(): void {
    if (this.readyTimer === undefined) return
    clearTimeout(this.readyTimer)
    this.readyTimer = undefined
  }
}
