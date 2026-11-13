# Agent Note: Desktop-global pet that survives client-window minimization

Status: Proposed

Interim: the companion-window line is implemented and live-verified; see
[the desktop companion note](../../implemented/feature/2026-11-05-desktop-companion-window.md).
This note remains the cross-platform end state.

Related: [the mount-point decision](../../implemented/architecture/2026-10-26-web-extensions-settings-seat.md)
put the pet on `document.body` so it survives session/page switches, and
[the visibility authority note](../../implemented/bug-fix/2026-09-30-pet-visibility-authority.md)
keeps "is it on screen" in one place. This note is about the next boundary: the
web contents itself disappears when the client window is minimized.

## Proposal

**Ask the DSH desktop shell for a plugin-owned overlay window, and render the
pet into it with the existing host API.** Do not ship a native executable in
the plugin, and do not patch `app.asar`.

### What the current architecture forbids

- The pet is a React portal on `document.body` inside the one web contents the
  Electron main process owns. Minimizing the window hides the whole page; no
  CSS, z-index, portal, `position: fixed`, or picture-in-picture bootstrap in
  that page can outlive it.
- The Desktop profile's **Host** (where a Cordis plugin runs) is a Node child
  process spawned with `stdio: [ignore, pipe, pipe, ipc]`
  (`app.asar/lib/main.js`, `dsh-desktop-host`). Its IPC switch accepts only
  `ready`, `shutdown`, `quit-inspection`, `update-tasks` and `platform-session`;
  the preload exposes no window creation. A plugin therefore cannot ask
  Electron for a `BrowserWindow`, `WebContentsView`, or overlay.
- The renderer's window bridge (`dshPlatform.open`) is scoped to the account
  usage/top-up pages and rejects every other page id.

The spike in `experiments/desktop-overlay/` confirms the state path: an
independent process can poll `GET /api/pet/state` and `GET /api/pet/pets` over
loopback without a cookie, render the selected pet in a transparent topmost
window, and remain visible while the Edge client is minimized. What it cannot
do is ship as part of the plugin without breaking the repository's
"never downloads executables" posture and the Windows/macOS split.

### Product shape

1. **Host side: one overlay surface.** `PetService` serves a standalone
   `GET /pet-overlay` document (same-origin, loopback-only, same guard as
   `/api/pet/*`). It imports the same pure helpers (`spritesheet.ts`,
   `sequences.ts`, `state.ts`) and polls the same state; it renders sprite2d,
   frames2d and live2d with the browser's own code path. A descriptor
   `GET /api/pet/overlay` returns
   `{ enabled, url, width, height, alwaysOnTop, clickThrough }`, so the window
   owner does not need to understand pet assets.
2. **Desktop shell: a sanctioned overlay API.** Expose a Cordis service
   (e.g. `ctx.desktopOverlay.create({ url, width, height, transparent,
   clickThrough, alwaysOnTop, skipTaskbar })`) that the Electron main process
   implements as a frameless, transparent, non-activating, always-on-top
   `BrowserWindow` with `setWindowOpenHandler(() => ({ action: 'deny' }))`,
   `sandbox: true`, no preload, and a loopback-only URL allow-list. On
   macOS this is `panel`/`setAlwaysOnTop`/`visibleOnAllWorkspaces`; on Windows
   `WS_EX_TOOLWINDOW` plus `setIgnoreMouseEvents(true, { forward: true })`
   with a hit-box toggle from the page. Focus never leaves the active app.
3. **Setting: `desktopOverlay: 'off' | 'minimize' | 'always'`** (default
   `off`). `minimize` shows the overlay only while the main window is
   minimized/hidden to tray; `always` keeps it when the window is visible. When
   the overlay is up, the in-page pet is hidden so there is exactly one pet.
   Interaction still goes through `POST /api/pet/interact`, so cooldowns and
   affinity stay host-authoritative; the overlay must not become a second
   writer.
4. **Lifecycle.** The overlay follows the plugin fiber: dispose on plugin
   disable/removal, on shell quit, and on a settings change. No orphan process.
   The overlay's position is persisted host-side (the same display config) or
   in a small overlay-specific file; a per-monitor clamp is mandatory.

### Acceptance criteria

- With the DSH window minimized to tray, the selected pet remains visible,
  animates from the same state, and a click/feed still reaches the host.
- Restoring the window hides the overlay and shows the in-page pet (no
  duplicate), within one poll tick.
- The overlay never steals focus, never appears in the taskbar or Alt+Tab, and
  clicks outside the pet pass through (Windows and macOS).
- Multi-monitor and per-monitor DPI place the pet on the monitor it was
  dragged to, and the position survives restart.
- `enabled: false`, plugin removal, shell quit and a crashed overlay all leave
  no process and no stale window.
- The overlay URL is loopback-only, rejects navigation and `window.open`, and
  carries no preload/Node integration.
- The npm tarball still contains no binaries; no executable is downloaded.
- `pnpm typecheck`, `pnpm test` and the Windows/macOS smoke matrix pass.

## Alternatives considered

- **Document Picture-in-Picture in the client half.** Cheap, always-on-top,
  and available in Chromium 116+; the pet's DOM and CSS could be moved into
  `documentPictureInPicture.requestWindow()`. Rejected as the primary shape:
  the PiP window is browser-owned and framed (no per-pixel transparency, a
  title bar, closes with the tab), it is a "floating mini window" rather than
  a desktop pet, and Electron support for `documentPictureInPicture` in the
  custom `dsh-app://` shell is unverified. Keep it as a web-only fallback.
- **Companion native process (the spike).** Proven to work, Windows-only,
  needs a second code base for macOS, and conflicts with the no-executable
  packaging rule. An opt-in, separately distributed helper could be offered to
  users who want it today, but it should not be a dependency of the plugin.
- **Patch `app.asar/lib/main.js`.** Rejected: not plugin-owned, breaks the
  signed bundle and updates, and would have to be reapplied every release.
- **A browser popup or a second tab.** Not always-on-top; hidden with the
  browser window; no benefit over the current mount.
- **A transparent child of the existing window.** Electron cannot parent a
  window to another app's window across the process boundary, and the shell's
  own transparent child (`DesktopUpdateOverlays`) is a modal input blocker,
  not a general overlay.

## Risks

- **Upstream dependency.** The whole feature waits on a DSH API. Without it the
  honest answer is "not possible from the plugin alone"; the companion spike
  is the only workaround.
- **Always-on-top is intrusive.** A pet over fullscreen games/videos or during
  screen sharing is unwanted. Default `off`; `minimize` is the recommended
  mode; add an escape hatch (tray item / context menu) and remember it.
- **Transparency and click-through differ per OS and compositor.** Windows
  layered windows and macOS panels need separate hit-testing tests; a
  click-through bug makes the desktop unusable. Ship a conservative hit box
  (the sprite rectangle plus the bubble), not the full window.
- **Two renderers, one state.** The overlay and the in-page pet both poll; the
  host is authoritative, so there is no write race, but two live2d instances
  double texture memory. Hide the in-page pet while the overlay is active and
  keep a single 2 s poll contract.
- **Security.** The overlay document must use the same loopback/paired-device
  fence as the API, and the Electron window must deny navigation, window.open,
  preload and Node integration. A loopback URL is not a trust boundary by
  itself.
- **Overlay position vs. display config.** The in-page `right`/`bottom` are
  viewport-relative; desktop coordinates are monitor-relative. Do not reuse
  the numbers blindly: persist a separate placement, or define the mapping
  explicitly, or the pet will jump when the client window changes size.
