import { usePlayerStore } from '@/store/player.store'
import { PlaybackSource } from '@/types/playerContext'
import { ISong } from '@/types/responses/song'

/**
 * What the listener was playing before joining a Jam, so they can go back
 * to it when the Jam ends.
 *
 * Kept under its own localStorage key and written once per Jam. It is not
 * part of the persisted Jam store because that store is rewritten on every
 * sync message, and a long queue would make each write expensive.
 */
const STORAGE_KEY = 'aonsoku-prejam-snapshot'

export interface JamSnapshot {
  list: ISong[]
  index: number
  progress: number
  source: PlaybackSource | null
}

export function saveJamSnapshot() {
  const { songlist, playerState, playerProgress } = usePlayerStore.getState()

  // Only song queues can be restored; radio and podcasts are not queued here.
  if (playerState.mediaType !== 'song' || songlist.currentList.length === 0) {
    clearJamSnapshot()
    return
  }

  const snapshot: JamSnapshot = {
    list: songlist.currentList,
    index: songlist.currentSongIndex,
    progress: playerProgress.progress,
    source: playerState.playbackContext.source ?? null,
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch (error) {
    // Storage full or unavailable: the Jam still works, restore just won't.
    console.warn('[Jam] Could not save the pre-Jam queue:', error)
  }
}

export function loadJamSnapshot(): JamSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const snapshot = JSON.parse(raw) as JamSnapshot
    return Array.isArray(snapshot.list) && snapshot.list.length > 0
      ? snapshot
      : null
  } catch {
    return null
  }
}

export function clearJamSnapshot() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
}

/**
 * Puts the saved queue back and seeks to where it was. Keeps the current
 * play/pause state so ending a Jam never starts or stops audio by surprise.
 */
export function restoreJamSnapshot(snapshot: JamSnapshot) {
  const { actions, playerState } = usePlayerStore.getState()
  const wasPlaying = playerState.isPlaying
  const index = Math.min(Math.max(snapshot.index, 0), snapshot.list.length - 1)

  actions.setSongList(snapshot.list, index, false, snapshot.source)
  if (!wasPlaying) actions.setPlayingState(false)

  // The audio element swaps its source on the next render, so wait for the
  // new track's metadata before seeking or the position would be discarded.
  const audio = usePlayerStore.getState().playerState.audioPlayerRef
  if (audio && snapshot.progress > 0) {
    const seek = () => {
      audio.currentTime = snapshot.progress
    }
    audio.addEventListener('loadedmetadata', seek, { once: true })
    setTimeout(() => audio.removeEventListener('loadedmetadata', seek), 15000)
  }
}
