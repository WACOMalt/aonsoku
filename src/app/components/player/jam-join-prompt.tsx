import { useEffect } from 'react'
import { toast } from 'react-toastify'
import { Button } from '@/app/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog'
import { jamService } from '@/service/jam'
import { useJamStore } from '@/store/jam.store'
import { isDesktop } from '@/utils/desktop'
import { buildJamAppLink } from '@/utils/jamLinks'
import { isCapacitor } from '@/utils/platform'

const COPY = {
  join: {
    title: 'Join a Music Jam?',
    description: "You've been invited to listen together.",
    action: 'Join Jam',
  },
  guest: {
    title: 'Switch Jams?',
    description:
      "You're already in a Jam. Joining this one takes you out of it.",
    action: 'Leave and join',
  },
  host: {
    title: 'End your Jam?',
    description:
      "You're hosting a Jam. Joining this one ends yours for everyone in it.",
    action: 'End mine and join',
  },
} as const

/**
 * Asks before joining a Jam from an invite. Mounted once in the signed-in
 * layout and driven by the persisted pending invite, so it works for a link
 * opened while signed out (shown after login), while the app is already open,
 * and for links handed over by the OS to the Android or desktop app.
 */
export function JamJoinPrompt() {
  const pendingId = useJamStore((state) => state.pendingJamSessionId)
  const currentId = useJamStore((state) => state.id)
  const isConnected = useJamStore((state) => state.isConnected)
  const isConnecting = useJamStore((state) => state.isConnecting)
  const isLead = useJamStore((state) => state.isLead)

  const inJam = !!currentId && (isConnected || isConnecting)
  const alreadyInIt = !!pendingId && pendingId === currentId && inJam

  const clearPending = () =>
    useJamStore.getState().actions.setPendingJamSessionId(null)

  useEffect(() => {
    if (!alreadyInIt) return
    toast.info("You're already in this Jam.")
    useJamStore.getState().actions.setPendingJamSessionId(null)
  }, [alreadyInIt])

  if (!pendingId || alreadyInIt) return null

  const copy = COPY[!inJam ? 'join' : isLead ? 'host' : 'guest']
  // In a browser, offer the installed app the way Spotify's web page does.
  const offerApp = !isCapacitor() && !isDesktop()

  const handleJoin = () => {
    clearPending()
    jamService.switchToSession(pendingId)
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) clearPending()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Session ID:{' '}
          <code className="bg-secondary px-1 rounded">{pendingId}</code>
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={clearPending}>
            Not now
          </Button>
          {offerApp && (
            <Button variant="secondary" asChild>
              <a href={buildJamAppLink(pendingId)}>Open in the app</a>
            </Button>
          )}
          <Button onClick={handleJoin}>{copy.action}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
