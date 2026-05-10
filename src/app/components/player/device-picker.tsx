import { Monitor, Volume2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { SimpleTooltip } from '@/app/components/ui/simple-tooltip'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/ui/popover'
import { useConnectState } from '@/store/connect.store'
import { connectService } from '@/service/connect'

export function DevicePicker() {
  const { devices, thisDeviceId, isConnected } = useConnectState()

  if (!isConnected) return null

  const handleTransfer = (deviceId: string) => {
    connectService.transferPlayback(deviceId)
  }

  return (
    <Popover>
      <SimpleTooltip text="Connect to a device">
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className={`relative rounded-full size-10 p-0 ${
              devices.length > 1
                ? 'text-primary'
                : 'text-secondary-foreground'
            }`}
          >
            <Monitor className="size-[18px]" />
            {devices.length > 1 && (
              <span className="absolute -top-0.5 -right-0.5 text-[10px] bg-primary text-primary-foreground rounded-full size-4 flex items-center justify-center">
                {devices.length}
              </span>
            )}
          </Button>
        </PopoverTrigger>
      </SimpleTooltip>

      <PopoverContent className="w-72" align="end">
        <div className="flex flex-col gap-3">
          <h4 className="font-semibold text-sm">Devices</h4>

          {devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No devices connected
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {devices.map((device) => {
                const isThis = device.id === thisDeviceId
                const isActive = device.isActivePlayer

                return (
                  <li
                    key={device.id}
                    className={`flex items-center justify-between p-2 rounded-md ${
                      isActive
                        ? 'bg-primary/10 border border-primary/20'
                        : 'bg-secondary/20'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isActive ? (
                        <Volume2 className="size-4 text-primary shrink-0" />
                      ) : (
                        <Monitor className="size-4 text-muted-foreground shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {device.name}
                          {isThis && (
                            <span className="text-muted-foreground">
                              {' '}
                              (this device)
                            </span>
                          )}
                        </p>
                        {isActive && (
                          <p className="text-xs text-primary">
                            Listening on this device
                          </p>
                        )}
                      </div>
                    </div>

                    {!isActive && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 ml-2"
                        onClick={() => handleTransfer(device.id)}
                      >
                        Transfer
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {devices.length <= 1 && (
            <p className="text-xs text-muted-foreground">
              Open this app on another device to see it here.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
