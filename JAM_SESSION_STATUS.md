# Aonsoku Jam & Connect Implementation — Status Report

This document summarizes the current state of the Music Jam session feature and the Aonsoku Connect system.

---

## Architecture Overview

Aonsoku now has a two-layer session system:

1. **Aonsoku Connect (Private Sessions)** — Automatic per-user device sync. When a user opens multiple browser tabs or devices, they share a single private session with synchronized playback state. One device is the "Active Player" (outputting audio), while others act as "Controllers" that can see and control playback remotely.

2. **Music Jam (Multi-User Sessions)** — Public, multi-user sessions layered on top of private sessions. When a user creates or joins a Jam, the Jam's playback state overrides their private session. When the Jam ends, each user's pre-Jam state is restored.

For full architectural details, see [`CONNECT_ARCHITECTURE.md`](CONNECT_ARCHITECTURE.md).

---

## Completed Work

### Backend Sync Server (`jam-sync-server/`)
- Node.js/Socket.io server on port 7548
- **Private session management**: automatic session creation keyed by `serverUrl::username`
- **Device tracking**: persistent `deviceId` (localStorage), human-readable device names
- **Active Player / Controller model**: one device plays audio, others control remotely
- **Playback transfer**: `transfer_playback`, `request_play_here` events
- **Remote commands**: `command` / `remote_command` forwarding (play, pause, next, prev, seek, volume)
- **Heartbeat & cleanup**: 30s heartbeat, 60s cleanup interval for stale devices
- **Jam session support**: creation, joining, leaving, host ending, guest control toggling
- **Pre-Jam state preservation**: saves and restores each user's playback state when Jam ends
- Deployed via `docker-compose` on `potato-vps1.bsums.xyz`

### Frontend — Connect Layer
- **`src/utils/deviceId.ts`** — Persistent device ID generation and human-readable device name detection
- **`src/store/connect.store.ts`** — Connection state, device list, active player tracking
- **`src/service/connect.ts`** — `ConnectService` owns the Socket.io connection:
  - Auto-connect on app load
  - Heartbeat, reconnection with exponential backoff
  - Playback state emission (active player only)
  - Remote sync for controllers
  - `become_active_player` / `become_controller` transitions
  - Remote command handling
  - Delegates Jam events to `JamService`
- **`src/app/hooks/use-connect.tsx`** — Auto-connect hook wired into `BaseLayout`

### Frontend — Connect UI
- **`src/app/components/player/device-picker.tsx`** — Popover showing all connected devices with "Play here" transfer buttons
- **`src/app/components/player/controller-banner.tsx`** — Banner shown when this device is a controller (not the active player)
- **`src/app/hooks/use-remote-player.tsx`** — Hook for remote player control logic
- Components integrated into the Player layout

### Frontend — Jam Layer
- **`src/store/jam.store.ts`** — Jam session state (participants, host status, guest control, sync threshold)
- **`src/service/jam.ts`** — `JamService` as a handler layer (no longer owns a socket; delegates to `ConnectService`):
  - `createSession()`, `joinSession()`, `leaveSession()`, `endSession()`
  - `setGuestControl()`
  - URL parsing for join links
- **`src/app/components/player/jam-button.tsx`** — Jam management UI:
  - Create/join sessions
  - Copy invite links (hash router format)
  - Participant list with host indicator
  - Guest control toggle (host only)
  - Sync threshold slider
  - Leave/End session buttons
- **`src/app/pages/jam/join.tsx`** — Direct join page via URL (`/jam/join/:sessionId`)
- **`src/routes/routesList.ts`** — Jam join route definition

### Frontend — Player Integration
- **`src/store/player.store.ts`** — Subscriptions emit playback state via `connectService` with `isActivePlayer` guards
- **`src/app/layout/base.tsx`** — Wires `useAutoConnect` hook for authenticated routes

### Infrastructure
- `docker-compose.yml` includes the `jam-sync` container
- Nginx proxy on `mus.bsums.xyz` routes `/jam-sync/` to the backend

---

## Current State

All core features are implemented and functional:

- ✅ Private sessions with automatic device sync
- ✅ Multi-device playback transfer
- ✅ Controller mode with remote commands
- ✅ Device picker UI
- ✅ Controller banner UI
- ✅ Music Jam creation, joining, leaving
- ✅ Host can end Jam for all participants
- ✅ Host can toggle guest playback control
- ✅ Configurable sync threshold
- ✅ Invite link generation and URL-based joining
- ✅ Pre-Jam state save/restore
- ✅ Heartbeat and stale device cleanup

---

## Known Considerations

1. **Authentication/Identity**: Relies on the username from `useAppStore` — no additional auth layer for the sync server.
2. **Sync Server Availability**: If the sync server is unreachable, the app continues to function normally with local-only playback.
3. **Legacy Protocol**: The server may still contain legacy Jam-only protocol support (old `sessionId`/`isLead` connection flow) that can be removed in a future cleanup pass.

---

## Roadmap

- [ ] Remove legacy Jam protocol from server (old `sessionId`/`isLead` connection flow)
- [ ] Add connect status indicator to header (optional — shows device count)
- [ ] Improve error handling and user-facing messages for sync failures
- [ ] Add graceful degradation UI when sync server is unavailable
- [ ] Comprehensive edge-case testing (tab close, refresh, logout, multi-user Jam, network interruption)
