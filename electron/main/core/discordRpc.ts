import {
  DEFAULT_LARGE_IMAGE,
  DEFAULT_SMALL_IMAGE,
  RPC,
  StatusDisplayType,
} from './discord'

export type RpcPayload = {
  trackName: string
  albumName: string
  artist: string
  startTime: number
  endTime: number
  duration: number
  coverArtUrl?: string
}

export async function setDiscordRpcActivity(payload: RpcPayload) {
  try {
    RPC.init()
    RPC.set({
      // "Artist - Song" is both the card headline and, via
      // status_display_type, the compact status shown under the username.
      details: `${payload.artist} - ${payload.trackName}`,
      state: payload.albumName,
      status_display_type: StatusDisplayType.Details,
      timestamps: {
        start: payload.startTime,
        end: payload.endTime,
      },
      assets: {
        large_image: payload.coverArtUrl || DEFAULT_LARGE_IMAGE,
        small_image: DEFAULT_SMALL_IMAGE,
      },
    })
  } catch {}
}

export function clearDiscordRpcActivity() {
  RPC.set(null)
}
