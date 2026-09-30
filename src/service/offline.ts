import { connectService } from '@/service/connect'
import { jamService } from '@/service/jam'
import { useJamStore } from '@/store/jam.store'

/**
 * Listening offline: the device leaves the sync server, so what it plays
 * does not affect the listener's online session on their other devices.
 * Offline here is not about the network or the music server; plays still
 * reach Navidrome as always.
 */

/** Going offline would end a Jam this device hosts, for everyone in it. */
export function offlineEndsHostedJam() {
  const { isConnected, isConnecting, isLead } = useJamStore.getState()
  return (isConnected || isConnecting) && isLead
}

/** Leaves (or, as host, ends) a Jam on this device, then goes offline. */
export function goOffline() {
  const { isConnected, isConnecting, isLead } = useJamStore.getState()
  if (isConnected || isConnecting) {
    if (isLead) jamService.endSession()
    else jamService.disconnect()
  }
  connectService.goOffline()
}

/** Back to the online session, which this device takes over. */
export function goOnline(choice: 'ask' | 'keep' = 'ask') {
  connectService.goOnline(choice)
}
