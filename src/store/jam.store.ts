import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { ISong } from '@/types/responses/song'

export interface IJamLeadState {
  songId: string
  isPlaying: boolean
  progress: number
  timestamp: number
  queue?: ISong[]
}

export interface IJamParticipant {
  id: string
  name: string
  isLead: boolean
}

export interface IJamSession {
  id: string | null
  participants: IJamParticipant[]
  isConnecting: boolean
  isConnected: boolean
  error: string | null
  isLead: boolean
  canGuestsControl: boolean
  lastLeadState: IJamLeadState | null
  syncThreshold: number
}

interface IJamActions {
  setSession: (sessionId: string, isLead: boolean) => void
  addParticipant: (participant: IJamParticipant) => void
  removeParticipant: (participantId: string) => void
  setParticipants: (participants: IJamParticipant[]) => void
  reset: () => void
  setError: (error: string | null) => void
  setConnecting: (value: boolean) => void
  setConnected: (value: boolean) => void
  setCanGuestsControl: (value: boolean) => void
  setLastLeadState: (state: IJamLeadState) => void
  setSyncThreshold: (value: number) => void
}

export const useJamStore = create<IJamSession & { actions: IJamActions }>()(
  devtools(
    immer(
      persist(
        (set) => ({
          id: null,
          participants: [],
          isConnecting: false,
          isConnected: false,
          error: null,
          isLead: false,
          canGuestsControl: false,
          lastLeadState: null,
          syncThreshold: 2,
          actions: {
            setSession: (sessionId, isLead) => {
              set((state) => {
                state.id = sessionId
                state.isLead = isLead
              })
            },
            addParticipant: (participant) => {
              set((state) => {
                if (!state.participants.find((p) => p.id === participant.id)) {
                  state.participants.push(participant)
                }
              })
            },
            removeParticipant: (participantId) => {
              set((state) => {
                state.participants = state.participants.filter(
                  (p) => p.id !== participantId,
                )
              })
            },
            setParticipants: (participants) => {
              set((state) => {
                state.participants = participants
              })
            },
            reset: () => {
              set((state) => {
                state.id = null
                state.participants = []
                state.isConnected = false
                state.isConnecting = false
                state.isLead = false
                state.error = null
                state.canGuestsControl = false
                state.lastLeadState = null
              })
            },
            setError: (error) => {
              set((state) => {
                state.error = error
              })
            },
            setConnecting: (value) => {
              set((state) => {
                state.isConnecting = value
              })
            },
            setConnected: (value) => {
              set((state) => {
                state.isConnected = value
              })
            },
            setCanGuestsControl: (value) => {
              set((state) => {
                state.canGuestsControl = value
              })
            },
            setLastLeadState: (leadState) => {
              set((state) => {
                state.lastLeadState = leadState
              })
            },
            setSyncThreshold: (value) => {
              set((state) => {
                state.syncThreshold = value
              })
            },
          },
        }),
        {
          name: 'jam-storage',
          partialize: (state) => ({ id: state.id, isLead: state.isLead, syncThreshold: state.syncThreshold }),
        },
      ),
    ),
  ),
)

export const useJamActions = () => useJamStore((state) => state.actions)
export const useJamState = () => useJamStore((state) => ({
    id: state.id,
    participants: state.participants,
    isConnected: state.isConnected,
    isConnecting: state.isConnecting,
    isLead: state.isLead,
    error: state.error,
    canGuestsControl: state.canGuestsControl,
    syncThreshold: state.syncThreshold,
}))
