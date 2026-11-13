# Agent Note: Desktop companion window for the global pet

Status: implemented

Related: [the desktop-global proposal](../../proposed/feature/2026-11-04-desktop-global-pet.md)
records the upstream overlay-window API as the cross-platform end state. This
note records the interim line the product asked for: launch an independent
companion window from the plugin, without waiting for the Shell API.

## Problem

The pet is a DOM layer on `document.body`. Minimizing the client stops painting
that web contents, so the pet disappears. The Desktop shell runs the Host in a
Node child process and exposes no plugin API for an Electron window (see the
proposal). A plugin alone cannot keep the pet on screen.

## Decision

**Opt-in desktop companion, launched and owned by the Host, with the in-page
pet suppressed while it runs.**

- **Launcher (`src/host/overlay.ts`).** `DesktopOverlay` discovers the companion
  program (`desktopOverlayCommand`, then
  `$DSH_HOME/pets/.runtime/dsh-pet-overlay/DshPetOverlay.exe`, then package and
  in-repo development locations), spawns it with `--base <host origin>` and
  `--parent-pid <host pid>`, reports `{ supported, running, pid?, error? }`, and
  kills it on disable or fiber disposal. A missing program is reported, never
  downloaded. A non-zero exit becomes `overlay-exited`; a clean user close
  clears the state so the page pet can return.
- **Config and card.** `desktopOverlay` is a volatile boolean (default off);
  `desktopOverlayCommand` is an optional plain path. The settings card adds a
  **Desktop** group with a switch and a live status line polled from
  `GET /api/pet/overlay` (supported/running/ready; the path stays host-side
  because the route also answers a paired device). The switch is disabled on
  unsupported platforms and shows a starting state until the companion reports
  ready. Script wrappers (`.ps1`/`.cmd`/`.bat`) are rejected: a wrapper parent
  cannot be trusted to own the real companion process.
- **Companion (`experiments/desktop-overlay`).** A small WPF program renders the
  selected pet in a frameless, per-pixel transparent, always-on-top,
  taskbar-less window. It polls the existing `/api/pet/*` routes (no new pet
  API), decodes WebP with alpha through a bundled libwebp decoder (WPF's WebP
  codec drops alpha), stacks one status bubble per active top-level session
  (current first; collapsed to the current bubble plus a `+N` badge, expandable
  with the badge and collapsible with `收起`), and shows each bubble's
  session/project title above the original status body. The hover panel below
  the sprite carries the pet name/rank, treat stock, affinity points and
  feed/rename/hide (feed and rename call the existing interact/set-name routes;
  hide closes the desktop window so the page pet returns). Drag, click-to-pet,
  a right-click menu, saved placement and `--parent-pid` exit are included. It
  reports `POST /api/pet/overlay/ready` after the first frame is on screen; the
  host uses that — not merely the spawned pid — to decide that the companion
  owns the pet. The install carries a JSON `companion.protocol` marker
  (`{protocol, sha256}`) generated at build/publish time; only a companion whose
  marker versions and hashes match the exe must report ready. An unmarked or
  stale-marker older install is treated as legacy-ready (the page hides once the
  process runs) so a Host upgrade cannot turn every start into a 15 s timeout
  flash. The Host passes `--host-protocol 2`; the current companion treats a 404
  from the ready route as a legacy Host only when that flag is absent, and
  closes if a Host that advertised protocol 2 has no route (avoiding two pets).
  It is **not** shipped in the npm tarball; an install publishes it under the
  user runtime directory.
- **One pet.** `PetService.state()` projects `desktopOverlayRunning` once the
  companion is ready; `PetDockEntry` renders neither the in-page sprite nor the
  summon button then. The API routes (including the ready route) are registered
  before the companion is spawned, so its first state fetch and ready POST
  cannot race plugin startup. A crashed or closed companion clears the flag on the next
  2 s poll and the page surface returns. A user close/hide (or crash) marks the
  companion dismissed, so unrelated settings updates do not silently restart it;
  the user cycles the switch off/on to start it again. The public overlay status
  exposes `dismissed`; the settings card says so explicitly for a clean hide/close
  and, when a failure also dismissed the companion, tells the user to cycle the
  switch and where the log is.
- **Lifecycle and titles.** The launcher follows the plugin fiber; disabling the
  plugin, turning the switch off, restarting the Host, or quitting the Shell
  stops the companion. Stops wait for the real exit before reporting stopped,
  and the companion exits when its parent pid is gone. The browser half owns the
  GUI session list, so it posts a bounded session-id → title map to
  `/api/pet/session-titles`; the host projects those titles into each session
  bubble for both the page and the desktop window. The title push runs on every
  session-list change even while the tab is hidden (the state poll stays
  visibility-gated), because the desktop companion is most useful then.

## Alternatives considered

- **Upstream overlay-window API (preferred long-term).** No binary, works on
  Windows and macOS, can reuse the existing web renderer. Still blocked on the
  Shell change; this note is the interim, not a replacement.
- **Document Picture-in-Picture.** No binary and always-on-top, but a
  browser-owned, framed, opaque window; closes with the tab; Electron support
  unverified. Remains a web-only fallback.
- **Browser popup / second tab.** Not always-on-top; hidden with the browser.
- **Patch `app.asar`.** Breaks the signed bundle and updates; not plugin-owned.
- **Ship the companion in the npm package.** Rejected: the plugin's security
  model says it never downloads or distributes executables. The companion is a
  user-installed runtime program, like the user-supplied Live2D Cubism Core.

## Consequences

- **Windows only.** macOS/Linux have no companion until the upstream API or a
  second native host exists.
- **Supported pets.** Without gameplay, `sprite2d` animates and `frames2d`
  shows the still named by `atlasUrl`. Pets with gameplay and `live2d` pets
  are rejected by the companion and keep using the page renderer, preserving
  the page gameplay loop. Reusing the web renderer would need a WebView2/Chromium host.
- **Startup and recovery.** Loading retries up to three times, with three seconds
  per attempt and ten seconds total including ready, below the Host's fifteen-second
  watchdog. Exit code 2 maps to `overlay-unsupported-pet`; code 3 maps to
  `overlay-start-failed`. These exits remain dismissed until the switch is cycled.
  Selecting another pet does not restart the companion. The unsupported-pet hint
  describes the previous exit and instructs users to select a supported pet, then
  turn the switch off and on. User closes and crashes do not restart automatically.
- **Ready access.** The ready route accepts only loopback requests. Public
  companion status omits the process ID.
- **Extra install step.** Publishing the companion under
  `$DSH_HOME/pets/.runtime/dsh-pet-overlay/` is required; the settings card's
  missing-program hint names the directory.
- **Two surfaces, one state.** Both poll the same host-authoritative state; the
  supported page surface is hidden after the companion reports ready, so interaction cooldowns and
  affinity are not double-applied.
- **Tests.** `src/host/overlay.test.ts` pins discovery, spawn args, stop,
  missing-program, crash, spawn-failure, exit-code classification and unsupported-platform behavior;
  `src/client/PetDockEntry.test.tsx` pins one-pet suppression;
  `src/client/PetSettingsCard.test.tsx` pins the switch write and bilingual
  recovery hints even when the current pet is supported;
  `src/client/gameplay-hud.test.tsx` verifies work ticks continue when desktop ready is reported;
  `tests/routes.spec.ts` rejects paired remote ready requests;
  `experiments/desktop-overlay-tests/Program.cs` exercises startup retries,
  failure codes, timeout and gameplay rejection in `CheckStartupFailures`;
  `src/service.test.ts` pins the `desktopOverlayRunning` projection. These are
  automated regression checks; the following live verification predates these fixes. Live
  verification: enabling `desktopOverlay` in the Desktop profile started the
  published companion (`/api/pet/overlay` → `running: true`), `/api/pet/state`
  carried `desktopOverlayRunning: true`, and disabling it returned both to
  false/absent.
