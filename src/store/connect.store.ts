import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

export interface IDevice {
  id: string
  name: string
  isActivePlayer: boolean
  lastSeen: string
}

export interface IConnectSession {
  // Connection state
  isConnected: boolean
  isConnecting: boolean
  error: string | null

  // Device state
  devices: IDevice[]
  thisDeviceId: string | null // socket.id of this device
  isActivePlayer: boolean // convenience: is THIS device the active player?
}

interface IConnectActions {
  setConnected: (value: boolean) => void
  setConnecting: (value: boolean) => void
  setError: (error: string | null) => void
  setDevices: (devices: IDevice[]) => void
  setThisDeviceId: (id: string) => void
  setIsActivePlayer: (value: boolean) => void
  reset: () => void
}

export const useConnectStore = create<
  IConnectSession & { actions: IConnectActions }
>()(
  devtools(
    immer((set) => ({
      isConnected: false,
      isConnecting: false,
      error: null,
      devices: [],
      thisDeviceId: null,
      isActivePlayer: true, // Default to true (single device = active)
      actions: {
        setConnected: (value) =>
          set((s) => {
            s.isConnected = value
          }),
        setConnecting: (value) =>
          set((s) => {
            s.isConnecting = value
          }),
        setError: (error) =>
          set((s) => {
            s.error = error
          }),
        setDevices: (devices) =>
          set((s) => {
            s.devices = devices
            // Update isActivePlayer based on this device's status
            if (s.thisDeviceId) {
              const thisDevice = devices.find((d) => d.id === s.thisDeviceId)
              // A list that does not include us yet says nothing about our role.
              if (thisDevice) s.isActivePlayer = thisDevice.isActivePlayer
            }
          }),
        setThisDeviceId: (id) =>
          set((s) => {
            s.thisDeviceId = id
          }),
        setIsActivePlayer: (value) =>
          set((s) => {
            s.isActivePlayer = value
          }),
        reset: () =>
          set((s) => {
            s.isConnected = false
            s.isConnecting = false
            s.error = null
            s.devices = []
            s.thisDeviceId = null
            s.isActivePlayer = true
          }),
      },
    })),
  ),
)

export const useConnectActions = () => useConnectStore((s) => s.actions)
export const useConnectState = () =>
  useConnectStore((s) => ({
    isConnected: s.isConnected,
    isConnecting: s.isConnecting,
    error: s.error,
    devices: s.devices,
    thisDeviceId: s.thisDeviceId,
    isActivePlayer: s.isActivePlayer,
  }))

/**
 * True when another of this user's devices is the one playing audio. This
 * device then mirrors that playback without sound and acts as a remote.
 */
export function isPassiveConnectDevice() {
  const { isConnected, isActivePlayer } = useConnectStore.getState()
  return isConnected && !isActivePlayer
}

/** Whether this device may output audio (see isPassiveConnectDevice). */
export const useCanOutputAudio = () =>
  useConnectStore((s) => !s.isConnected || s.isActivePlayer)
