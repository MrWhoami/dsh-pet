import { useSyncExternalStore } from 'react'

export type PetSurface = 'auto' | 'page' | 'desktop'
const KEY = 'dsh-pet.surface'
let current: PetSurface | undefined

/** Per-tab preference; never changes the Host's desktop setting or access rules. */
export function petSurface(): PetSurface {
  if (current !== undefined) return current
  try {
    const value = sessionStorage.getItem(KEY)
    current = value === 'page' || value === 'desktop' ? value : 'auto'
  } catch { current = 'auto' }
  return current
}

export function setPetSurface(value: PetSurface): void {
  current = value
  try { sessionStorage.setItem(KEY, value) } catch { /* Keep the in-memory preference. */ }
  window.dispatchEvent(new Event(KEY))
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(KEY, listener)
  return () => { window.removeEventListener(KEY, listener) }
}

export function usePetSurface(): PetSurface {
  return useSyncExternalStore(subscribe, petSurface)
}
