import { app, ipcMain } from 'electron'
import { resolve } from 'path'
import { IpcChannels } from '../../preload/types'
import { mainWindow } from '../window'

/** aonsoku://jam/<id> opens a Jam invite in the desktop app. */
const PROTOCOL = 'aonsoku'

// A link waits here until the renderer takes it. Holding it rather than
// pushing it avoids losing one that arrives before the page has loaded.
let pendingLink: string | null = null

export function findDeepLink(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${PROTOCOL}://`)) ?? null
}

/** Queues a link and tells the renderer one is waiting. */
export function deliverDeepLink(url: string) {
  pendingLink = url
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcChannels.DeepLink)
  }
}

/** Makes this app the handler for aonsoku:// links. */
export function registerDeepLinkProtocol() {
  if (process.defaultApp && process.argv.length >= 2) {
    // Running unpackaged (electron .), so point the OS at this script too.
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      resolve(process.argv[1]),
    ])
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL)
  }

  // Windows and Linux pass the link on the command line of a cold start.
  const launchLink = findDeepLink(process.argv)
  if (launchLink) pendingLink = launchLink

  ipcMain.handle(IpcChannels.GetPendingDeepLink, () => {
    const url = pendingLink
    pendingLink = null
    return url
  })
}
