import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { ISong } from '@/types/responses/song'

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
          },
        }),
        {
          name: 'jam-storage',
          partialize: (state) => ({ id: state.id, isLead: state.isLead }),
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
}))
