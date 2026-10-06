import icon from '../assets/icon.png'
import type { DeviceState } from '../../../shared/api'

/**
 * Custom title bar. The window controls (minimise / maximise / close) are drawn by the OS on top
 * of it (titleBarOverlay), so snapping and the system menu keep working. The env() values keep
 * our content clear of those controls on Windows and of the traffic lights on macOS.
 */
export function TitleBar({ device }: { device: DeviceState }): React.JSX.Element {
  const connected = device.status === 'connected'
  return (
    <div className="drag h-9 shrink-0 bg-[var(--titlebar)]">
      <div
        className="flex h-full items-center gap-2 px-3 text-xs text-muted"
        style={{ marginLeft: 'env(titlebar-area-x, 0px)', width: 'env(titlebar-area-width, 100%)' }}
      >
        <img src={icon} alt="" className="h-6 w-6 rounded-md" draggable={false} />
        <span className="font-semibold text-fg">SnekPad Studio</span>
        <span className="ml-3 flex items-center gap-1.5" role="status">
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-ok' : 'bg-muted'}`} />
          {connected ? device.label : 'No pad'}
        </span>
      </div>
    </div>
  )
}
