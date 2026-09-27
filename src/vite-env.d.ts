/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sync server the native apps fall back to; see .env.production. */
  readonly VITE_DEFAULT_SYNC_SERVER_URL?: string
}
