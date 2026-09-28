/**
 * Bridge to the Android app's native song player (NativePlayerPlugin.java),
 * which plays through ExoPlayer: tracks join sample-accurately, and playback
 * does not depend on the WebView staying awake.
 */

import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'
import { getNativePlatform } from '@/utils/platform'

export interface NativeItem {
  /** Unique per item sent, so events can be matched to it. */
  key: string
  url: string
  title: string
  artist: string
  album: string
  artworkUrl: string
  durationMs: number
  /** Linear ReplayGain factor. */
  gain: number
}

export interface NativeProgress {
  key: string
  positionMs: number
  durationMs: number
  playing: boolean
  state: number
}

interface NativePlayerPlugin {
  load(options: {
    current: NativeItem
    next?: NativeItem
    positionMs: number
    playWhenReady: boolean
    repeatOne: boolean
    volume: number
  }): Promise<void>
  setNext(options: { next?: NativeItem }): Promise<void>
  skipToNext(options: { key: string }): Promise<{ skipped: boolean }>
  setPlaying(options: { playing: boolean }): Promise<void>
  seekTo(options: { positionMs: number }): Promise<void>
  setVolume(options: { volume: number }): Promise<void>
  setRepeatOne(options: { enabled: boolean }): Promise<void>
  stop(): Promise<void>
  getState(): Promise<NativeProgress>

  addListener(
    event: 'progress',
    callback: (data: NativeProgress) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    event: 'transition',
    callback: (data: { key: string; reason: number }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    event: 'playing',
    callback: (data: { playing: boolean; reason: number }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    event: 'ended',
    callback: (data: { key: string }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    event: 'error',
    callback: (data: { key: string; code: string; message: string }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    event: 'command',
    callback: (data: { action: 'nexttrack' | 'previoustrack' }) => void,
  ): Promise<PluginListenerHandle>
}

// Registered once, synchronously (see androidMediaSession.ts for why).
export const NativePlayer =
  getNativePlatform() === 'android'
    ? registerPlugin<NativePlayerPlugin>('NativePlayer')
    : null

/**
 * Whether songs play through the native player: only in the Android app,
 * with gapless on (turning it off falls back to the WebView's player), and
 * only on the device that outputs the audio (a passive Connect device plays
 * nothing, and its notification mirrors the other device instead).
 */
export function usesNativeSongPlayer(
  canOutputAudio: boolean,
  gaplessEnabled: boolean,
) {
  return NativePlayer !== null && canOutputAudio && gaplessEnabled
}
