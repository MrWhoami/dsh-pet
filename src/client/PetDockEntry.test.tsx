// @vitest-environment jsdom
/**
 * The hidden-state summon button opts into the L2 semantic attributes
 * (issue #506): it carries data-dsh-part="summon-button" so skins can target
 * it without hash-class selectors.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { setPetSurface } from './pet-surface.ts'
// The npm SDK's client half is a closure-factory bundle for the GUI's
// __ModuleLoader__ (not importable under vitest); provide the defineStore
// the pet store needs (same fake-store pattern as the settings-card tests).
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  defineStore: (spec: {
    init: () => unknown
    actions: Record<string, (draft: never, ...args: never[]) => void>
  }) => ({
    create: () => {
      let value = spec.init()
      const listeners = new Set<() => void>()
      const actions: Record<string, (...args: unknown[]) => void> = {}
      for (const [name, fn] of Object.entries(spec.actions)) {
        actions[name] = (...args: unknown[]) => {
          fn(value as never, ...(args as never[]))
          for (const listener of listeners) listener()
        }
      }
      return {
        getSnapshot: () => value,
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        actions,
      }
    },
  }),
}))
import { PetDockEntry, type PetInjected } from './PetDockEntry.tsx'
import { createPetStore } from './pet-store.ts'
import { t } from './locales.ts'
import type { PetStateView } from '../service.ts'

beforeAll(() => {
  document.documentElement.lang = 'zh'
})

afterEach(() => { cleanup(); setPetSurface('auto'); sessionStorage.clear(); vi.unstubAllGlobals() })

/** Snapshot fixture with the pet hidden (the summon-button state). */
const hiddenSnapshot: PetStateView = {
  animation: 'idle',
  phase: 'idle',
  sessionActive: false,
  affinity: {
    points: 0,
    rank: '幼鲸',
    rankEmoji: '*',
    pets: 0,
    feeds: 0,
    turns: 0,
    petCooldown: false,
    feedCooldown: false,
  },
  display: { visible: false, size: 160, right: 24, bottom: 20, bubbleScale: 1 },
  pet: { id: 'whale-girl', displayName: '鲸鱼娘', description: '测试用鲸鱼娘' },
  name: '泡泡',
  treats: { stocked: 0, max: 5 },
}

function injected(): PetInjected {
  return {
    store: createPetStore().create(),
    ensure: vi.fn(),
    pet: vi.fn(),
    feed: vi.fn(),
    hide: vi.fn(),
    summon: vi.fn(),
    dragEnd: vi.fn(),
    rename: vi.fn(),
    panelAction: vi.fn(),
    openSession: vi.fn(),
    feedbackDone: vi.fn(),
    gameplay: {
      touch: vi.fn(),
      setMode: vi.fn(),
      workTick: vi.fn(),
      buy: vi.fn(),
      setSkin: vi.fn(async () => ({ ok: true })),
    },
  }
}

describe('PetDockEntry L2 semantic attributes (#506)', () => {
  it('allows a tunneled page to keep its pet and a LAN page to use the ready desktop pet', () => {
    const props = injected()
    const snapshot = { ...hiddenSnapshot, display: { ...hiddenSnapshot.display, visible: true }, desktopOverlayRunning: true }
    props.store.actions.setSnapshot(snapshot)
    const view = render(<PetDockEntry {...props} t={t} />)
    act(() => { setPetSurface('page') })
    expect(screen.getByTestId('pet-dock')).toBeTruthy()
    vi.stubGlobal('location', { hostname: '192.168.1.20' })
    act(() => { setPetSurface('desktop') })
    expect(screen.getByTestId('pet-desktop-overlay')).toBeTruthy()
    act(() => { props.store.actions.setSnapshot({ ...snapshot, desktopOverlayRunning: false }) })
    view.rerender(<PetDockEntry {...props} t={t} />)
    expect(screen.getByTestId('pet-dock')).toBeTruthy()
  })
  it('tags the summon button as the summon-button part', () => {
    const props = injected()
    props.store.actions.setSnapshot(hiddenSnapshot)
    render(<PetDockEntry {...props} t={t} />)
    const summon = screen.getByTestId('pet-summon')
    expect(summon.getAttribute('data-dsh-part')).toBe('summon-button')
  })

  it('leaves the page surface to the desktop companion while it runs', () => {
    const props = injected()
    props.store.actions.setSnapshot({
      ...hiddenSnapshot,
      display: { ...hiddenSnapshot.display, visible: true },
      desktopOverlayRunning: true,
    })
    render(<PetDockEntry {...props} t={t} />)
    // One pet only: neither the in-page sprite nor the summon control renders
    // while the separate desktop window owns the pet.
    expect(screen.queryByTestId('pet-dock')).toBeNull()
    expect(screen.queryByTestId('pet-summon')).toBeNull()
    expect(screen.getByTestId('pet-desktop-overlay')).toBeTruthy()
  })

  it('hides the page pet in the desktop app and restores it when the companion stops', () => {
    vi.stubGlobal('location', { protocol: 'dsh-app:', hostname: 'app' })
    const props = injected()
    const snapshot = {
      ...hiddenSnapshot,
      display: { ...hiddenSnapshot.display, visible: true },
      desktopOverlayRunning: true,
    }
    props.store.actions.setSnapshot(snapshot)
    const view = render(<PetDockEntry {...props} t={t} />)
    expect(screen.queryByTestId('pet-dock')).toBeNull()
    expect(screen.queryByTestId('pet-summon')).toBeNull()
    expect(screen.getByTestId('pet-desktop-overlay')).toBeTruthy()
    props.store.actions.setSnapshot({ ...snapshot, desktopOverlayRunning: false })
    view.rerender(<PetDockEntry {...props} t={t} />)
    expect(screen.getByTestId('pet-dock')).toBeTruthy()
  })

  it('keeps the summon button available while the desktop pet is hidden', () => {
    const props = injected()
    props.store.actions.setSnapshot({ ...hiddenSnapshot, desktopOverlayRunning: true })
    render(<PetDockEntry {...props} t={t} />)
    expect(screen.getByTestId('pet-summon')).toBeTruthy()
  })

  it('keeps the page pet on a remote browser', () => {
    vi.stubGlobal('location', { hostname: '192.168.1.20' })
    const props = injected()
    props.store.actions.setSnapshot({
      ...hiddenSnapshot,
      display: { ...hiddenSnapshot.display, visible: true },
      desktopOverlayRunning: true,
    })
    render(<PetDockEntry {...props} t={t} />)
    expect(screen.getByTestId('pet-dock')).toBeTruthy()
  })
})
