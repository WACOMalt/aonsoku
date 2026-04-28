# Aonsoku Spotify-Style Jam Implementation - Status Report

This document summarizes the current state of the "Jam" session feature implementation for Aonsoku and outlines the next steps.

## Completed Work
1.  **Backend Sync Server (`jam-sync-server/`):**
    *   Implemented Node.js/Socket.io server on port 7548.
    *   Handles session creation, participant tracking, and playback synchronization (track ID, playing state, progress, queue).
    *   Deployed via `docker-compose` on `potato-vps1.bsums.xyz`.
2.  **Frontend State (`src/store/jam.store.ts`):**
    *   Added `useJamStore` for session state (id, participants, connection status, lead status).
3.  **Frontend Sync (`src/service/jam.ts`):**
    *   Integrated `socket.io-client`.
    *   Configured to use `/jam-sync/socket.io` for Nginx proxy compatibility.
    *   Handles real-time playback synchronization.
4.  **UI (`src/app/components/player/jam-button.tsx`):**
    *   Added a Jam management interface in the player footer.
    *   Allows creating/joining sessions and copying invite links.
5.  **Infrastructure:**
    *   Updated `docker-compose.yml` to include the `jam-sync` container.
    *   Updated Nginx proxy on `mus.bsums.xyz` to route `/jam-sync/` to the backend.

## Known Issues
1.  **Leave Session Functionality:** Currently, participants cannot cleanly leave the session.
2.  **Host Control Toggling:** Guests cannot be restricted from controlling playback (e.g., pause/skip).
3.  **Authentication/Identity:** Currently relies on the username from `useAppStore`.

## Current Tasks / Roadmap
1.  **Fix "Leave Jam" Feature:**
    *   Implement `jamService.leaveSession()` to properly notify the backend and clear local state.
    *   Ensure the backend handles participant removal gracefully.
2.  **Host Controls:**
    *   Add a toggle in the Jam UI for the host: "Allow guests to control."
    *   Update `jam.store.ts` and sync the `canGuestsControl` state to all participants.
    *   Ensure guests are blocked from emitting `playback_update` if the host has disabled guest control.
3.  **Refinement:**
    *   Better handle session termination for the host.
    *   Add better error handling and UI feedback for connection drops.
