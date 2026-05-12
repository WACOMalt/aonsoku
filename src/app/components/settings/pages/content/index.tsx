import { ImagesContent } from './images'
import { PodcastContent } from './podcast'
import { SidebarContent } from './sidebar'
import { SyncServerContent } from './sync-server'

export function Content() {
  return (
    <div className="space-y-4">
      <SidebarContent />
      <PodcastContent />
      <SyncServerContent />
      <ImagesContent />
    </div>
  )
}
