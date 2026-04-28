import { Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/app/components/ui/button'
import { SimpleTooltip } from '@/app/components/ui/simple-tooltip'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/app/components/ui/dialog'
import { Input } from '@/app/components/ui/input'
import { useJamState, useJamActions } from '@/store/jam.store'
import { jamService } from '@/service/jam'
import { toast } from 'react-toastify'

export function JamButton() {
  const { t } = useTranslation()
  const { id, isConnected, participants, isLead } = useJamState()
  const { reset } = useJamActions()
  const [joinId, setJoinId] = useState('')

  const handleCreate = () => {
    const newId = jamService.createSession()
    toast.success('Jam session created!')
  }

  const handleJoin = () => {
    if (joinId.trim()) {
      jamService.joinSession(joinId.trim())
      setJoinId('')
    }
  }

  const handleLeave = () => {
    jamService.disconnect()
    toast.info('Left Jam session')
  }

  const copyLink = () => {
    const link = `${window.location.origin}/jam/${id}`
    navigator.clipboard.writeText(link)
    toast.success('Invite link copied!')
  }

  return (
    <Dialog>
      <SimpleTooltip text={id ? 'Manage Jam' : 'Start Jam'}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            className={`relative rounded-full size-10 p-0 ${id ? 'text-primary' : 'text-secondary-foreground'}`}
          >
            <Users className="size-[18px]" />
            {id && isConnected && (
              <span className="absolute top-1 right-1 size-2 bg-green-500 rounded-full border-2 border-background" />
            )}
          </Button>
        </DialogTrigger>
      </SimpleTooltip>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Spotify-style Jam</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          {!id ? (
            <>
              <Button onClick={handleCreate}>Start a new Jam</Button>
              <div className="flex gap-2">
                <Input
                  placeholder="Paste Session ID"
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                />
                <Button variant="secondary" onClick={handleJoin}>Join</Button>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <span className="font-bold">Session: {id}</span>
                <Button size="sm" variant="outline" onClick={copyLink}>Copy Invite Link</Button>
              </div>
              
              <div className="bg-secondary/20 p-3 rounded-md">
                <h4 className="text-sm font-semibold mb-2">Participants ({participants.length})</h4>
                <ul className="text-sm space-y-1">
                  {participants.map(p => (
                    <li key={p.id} className="flex justify-between">
                      <span>{p.name} {p.id === id ? '(Host)' : ''}</span>
                      {p.isLead && <span className="text-[10px] bg-primary/20 px-1 rounded">Lead</span>}
                    </li>
                  ))}
                </ul>
              </div>

              <Button variant="destructive" onClick={handleLeave}>
                {isLead ? 'End Jam for all' : 'Leave Jam'}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
