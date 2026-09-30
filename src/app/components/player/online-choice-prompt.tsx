import { Button } from '@/app/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog'
import { connectService } from '@/service/connect'
import { useConnectStore } from '@/store/connect.store'

/**
 * Back online after listening offline, with a queue both here and in the
 * online session: this device takes the online session over, and the
 * listener picks which queue it continues with. Mounted once in the
 * signed-in layout.
 */
export function OnlineChoicePrompt() {
  const choice = useConnectStore((state) => state.onlineChoice)
  if (!choice) return null

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        // Closing it keeps what is playing here.
        if (!isOpen) connectService.resolveOnlineChoice('keep')
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>You're back online</DialogTitle>
          <DialogDescription>
            Your online session has a queue of its own
            {choice.onlineSong ? ` (${choice.onlineSong})` : ''}. Continue here
            with which one?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => connectService.resolveOnlineChoice('resume')}
          >
            Resume online queue
          </Button>
          <Button onClick={() => connectService.resolveOnlineChoice('keep')}>
            Keep this queue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
