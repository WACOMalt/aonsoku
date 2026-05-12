import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'xyz.bsums.aonsoku',
  appName: 'Aonsoku',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config
