import { Client } from '@xhayper/discord-rpc'
import { productName } from '../../../package.json'

export const StatusDisplayType = {
  Name: 0,
  State: 1,
  Details: 2,
}

const ActivityType = {
  Game: 0,
  Streaming: 1,
  Listening: 2,
  Watching: 3,
  Custom: 4,
  Competing: 5,
}

type IActivity = {
  timestamps?: {
    start?: number
    end?: number
  }
  details?: string
  state?: string
  assets?: {
    large_image?: string
    large_text?: string
    small_image?: string
    small_text?: string
  }
  instance?: boolean
  type?: number
  /**
   * What Discord shows in the compact status line under the username:
   * 0 = application name, 1 = state, 2 = details.
   */
  status_display_type?: number
}

export type PayloadType = {
  pid: number
  activity: IActivity | null
}

export const DEFAULT_LARGE_IMAGE = 'icon'
export const DEFAULT_SMALL_IMAGE = 'song_icon'

const defaultPayload: PayloadType = {
  pid: process.pid,
  activity: {
    timestamps: {
      start: Date.now(),
    },
    details: productName,
    assets: {
      large_image: DEFAULT_LARGE_IMAGE,
      small_image: DEFAULT_SMALL_IMAGE,
    },
    instance: true,
    type: ActivityType.Listening,
  },
}

let discord: Client | null = null
let lastPayload: PayloadType | null = null

function init() {
  if (discord) return

  const DISCORD_CLIENT_ID = import.meta.env.MAIN_VITE_DISCORD_CLIENT_ID

  if (!DISCORD_CLIENT_ID) {
    console.log('Discord Client ID not found.')
    return
  }

  // @xhayper/discord-rpc probes the standard, Snap and Flatpak IPC socket
  // locations on Linux, which the original discord-rpc package did not.
  discord = new Client({
    clientId: DISCORD_CLIENT_ID,
    transport: { type: 'ipc' },
  })

  discord.on('ready', () => {
    discord?.request('SET_ACTIVITY', lastPayload ?? defaultPayload)
  })

  discord.on('disconnected', () => {
    setTimeout(() => loginRPC(), 1000).unref()
  })
  loginRPC()
}

function loginRPC() {
  if (!discord) return

  discord.login().catch(() => {
    setTimeout(() => loginRPC(), 5000).unref()
  })
}

function set(data: IActivity | null) {
  if (!discord || !discord.user) return

  if (data) {
    data.instance = true
    data.type = ActivityType.Listening
  }
  const payload = {
    pid: process.pid,
    activity: data,
  }
  lastPayload = payload

  discord.request('SET_ACTIVITY', payload)
}

export const RPC = {
  init,
  set,
}
