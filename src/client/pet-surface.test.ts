// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); vi.resetModules() })

it('keeps the current choice when writes fail but reads still succeed', async () => {
  vi.stubGlobal('sessionStorage', {
    getItem: () => 'auto',
    setItem: () => { throw new DOMException('full', 'QuotaExceededError') },
  })
  const { petSurface, setPetSurface } = await import('./pet-surface.ts')
  expect(petSurface()).toBe('auto')
  setPetSurface('page')
  expect(petSurface()).toBe('page')
})

it('works when both storage reads and writes fail', async () => {
  vi.stubGlobal('sessionStorage', {
    getItem: () => { throw new Error('denied') },
    setItem: () => { throw new Error('denied') },
  })
  const { petSurface, setPetSurface } = await import('./pet-surface.ts')
  expect(petSurface()).toBe('auto')
  setPetSurface('desktop')
  expect(petSurface()).toBe('desktop')
})

it('initializes from storage and persists choices for the next page load', async () => {
  sessionStorage.setItem('dsh-pet.surface', 'page')
  const { petSurface, setPetSurface } = await import('./pet-surface.ts')
  expect(petSurface()).toBe('page')
  setPetSurface('desktop')
  expect(sessionStorage.getItem('dsh-pet.surface')).toBe('desktop')
  vi.resetModules()
  expect((await import('./pet-surface.ts')).petSurface()).toBe('desktop')
})
