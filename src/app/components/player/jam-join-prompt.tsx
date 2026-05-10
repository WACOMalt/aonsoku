import { useEffect, useState } from 'react'
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

export function JamJoinPrompt() {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const id = useJamStore.getState().pendingJamSessionId
    if (id) {
      setPendingId(id)
      setOpen(true)
    }
  }, [])

  const handleJoin = () => {
    if (pendingId) {
      useJamStore.getState().actions.setPendingJamSessionId(null)
      jamService.joinSession(pendingId)
      toast.success('Joined the Jam session!')
    }
    setOpen(false)
  }

  const handleDecline = () => {
    useJamStore.getState().actions.setPendingJamSessionId(null)
    setOpen(false)
  }

  if (!pendingId) return null

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) handleDecline()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Join a Music Jam?</DialogTitle>
          <DialogDescription>
            You've been invited to join a Music Jam session. Would you like to
            join and listen together?
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-muted-foreground">
            Session ID:{' '}
            <code className="bg-secondary px-1 rounded">{pendingId}</code>
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleDecline}>
            No thanks
          </Button>
          <Button onClick={handleJoin}>Join Jam</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
