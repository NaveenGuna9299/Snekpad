import type { DeviceState } from '../../../shared/api'

type Props = {
  device: DeviceState
  mock: boolean
  onMock: (on: boolean) => void
  onPush: () => void
  pushing: boolean
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onReset: () => void
  onHome: () => void
}

export function TopBar({ onHome, device, mock, onMock, onPush, pushing, canUndo, canRedo, onUndo, onRedo, onReset }: Props): React.JSX.Element {
  const connected = device.status === 'connected'
  return (
    <header className="flex items-center gap-3 border-b border-line bg-bg px-4 py-2.5 shadow-sm">
      <h1 className="sr-only">SnekPad Studio</h1>
      <button onClick={onHome} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface2">Home</button>

      <div className="flex items-center gap-2 text-sm" role="status" aria-live="polite">
        <span className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-ok' : 'bg-muted'}`} />
        {connected ? `Connected: ${device.label}` : 'No pad found. Plug in your SnekPad, or use the mock pad.'}
      </div>
      {device.error && !connected && <span className="text-xs text-danger">{device.error}</span>}

      <label className="ml-2 flex items-center gap-1.5 text-xs text-muted">
        <input type="checkbox" checked={mock} onChange={(e) => onMock(e.target.checked)} />
        Mock pad
      </label>

      <div className="ml-auto flex items-center gap-2">
        <button onClick={onUndo} disabled={!canUndo} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface2 disabled:opacity-40">Undo</button>
        <button onClick={onRedo} disabled={!canRedo} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface2 disabled:opacity-40">Redo</button>
        <button onClick={onReset} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface2">Restore defaults</button>
        <button
          onClick={onPush}
          disabled={!connected || pushing}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-accentfg disabled:opacity-40"
          title={connected ? 'Send this setup to the pad' : 'Connect a pad first'}
        >
          {pushing ? 'Sending…' : 'Push to pad'}
        </button>
      </div>
    </header>
  )
}
