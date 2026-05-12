// Generate a persistent device ID for this browser tab/instance
const STORAGE_KEY = 'aonsoku-device-id'

function generateDeviceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`
}

export function getDeviceId(): string {
  let id = sessionStorage.getItem(STORAGE_KEY)
  if (!id) {
    id = generateDeviceId()
    sessionStorage.setItem(STORAGE_KEY, id)
  }
  return id
}

export function getDeviceName(): string {
  const ua = navigator.userAgent
  // Simple device name detection
  if (
    typeof (window as unknown as Record<string, unknown>).Capacitor !==
    'undefined'
  )
    return 'Android App'
  if (ua.includes('Electron')) return 'Desktop App'
  if (ua.includes('Chrome')) return `Chrome on ${getOS()}`
  if (ua.includes('Firefox')) return `Firefox on ${getOS()}`
  if (ua.includes('Safari')) return `Safari on ${getOS()}`
  return `Browser on ${getOS()}`
}

function getOS(): string {
  const ua = navigator.userAgent
  if (ua.includes('Windows')) return 'Windows'
  if (ua.includes('Mac')) return 'macOS'
  if (ua.includes('Linux')) return 'Linux'
  if (ua.includes('Android')) return 'Android'
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS'
  return 'Unknown'
}
