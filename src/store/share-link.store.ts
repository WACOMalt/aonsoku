import { create } from 'zustand'

export const SHARED_ITEM_TYPES = [
  'song',
  'album',
  'artist',
  'playlist',
] as const

export type SharedItemType = (typeof SHARED_ITEM_TYPES)[number]

export interface SharedItem {
  type: SharedItemType
  id: string
}

interface ShareLinkState {
  /** A shared item waiting to be opened once the listener is signed in. */
  pending: SharedItem | null
  setPending: (item: SharedItem | null) => void
}

// Not persisted: signing in happens inside the same page load, and a stale
// link resurfacing on a later launch would be more confusing than helpful.
export const useShareLinkStore = create<ShareLinkState>((set) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
}))
