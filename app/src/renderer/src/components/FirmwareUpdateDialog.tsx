import { useEffect } from 'react'
import type { DeviceState } from '../../../shared/api'
import { FW_CONFIRM_MS } from '../../../shared/firmwareUpdate'
import { useFirmwareUpdate, type UpdatePhase } from '../lib/useFirmwareUpdate'

type Props = {
  device: DeviceState
  /** The firmware version inside this build of Studio: what the pad is updated to. */
  bundleVersion: string
  onClose: () => void
}

const WORKING: UpdatePhase[] = [
  'checking',
  'waiting',
  'sending',
  'finishing',
  'restarting',
  'verifying'
]
const CANCELLABLE: UpdatePhase[] = ['checking', 'waiting', 'sending']

/** Update the pad's firmware from Studio: explains it, asks for the knob press, shows progress, and the result. */
export function FirmwareUpdateDialog({ device, bundleVersion, onClose }: Props): React.JSX.Element {
  const fw = useFirmwareUpdate(device, bundleVersion)
  const working = WORKING.includes(fw.phase)

  // Escape closes the dialog, but never while the pad is being updated
  useEffect(() => {
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !working) onClose()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [working, onClose])

  const percent =
    fw.progress && fw.progress.total > 0
      ? Math.min(100, Math.round((fw.progress.sent / fw.progress.total) * 100))
      : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fwu-title"
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-line bg-surface p-6 shadow-2xl"
      >
        <h2 id="fwu-title" className="text-lg font-semibold">
          Update pad firmware
        </h2>

        {fw.phase === 'idle' && (
          <>
            <p className="text-sm">
              Pad firmware {device.firmware ?? 'unknown'} → <strong>{bundleVersion}</strong>
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>
                Keep the pad plugged in: <strong>do not unplug it during the update.</strong>
              </li>
              <li>When asked, press the knob on the pad to allow the update.</li>
              <li>Wait: the pad restarts by itself, which takes about half a minute.</li>
            </ol>
            <p className="text-xs text-muted">
              If anything goes wrong, the pad keeps its old firmware. Your keys and profiles stay as
              they are. Unplugging the pad while it is being written can damage its storage, and
              then it has to be re-flashed.
            </p>
          </>
        )}
        {fw.phase === 'checking' && <p className="text-sm">Checking the pad…</p>}
        {fw.phase === 'waiting' && (
          <p className="text-sm" role="status">
            <strong>Press the knob on the pad</strong> to allow the update. The pad shows “UPDATE{' '}
            {bundleVersion}” and waits {Math.round(FW_CONFIRM_MS / 1000)} seconds. Keep it plugged
            in.
          </p>
        )}
        {fw.phase === 'sending' && (
          <div className="flex flex-col gap-2 text-sm">
            <progress
              aria-label="Sending firmware"
              className="h-2 w-full"
              value={percent}
              max={100}
            />
            <p role="status">
              Sending {fw.progress?.file} ({percent}%). <strong>Do not unplug the pad.</strong>
            </p>
          </div>
        )}
        {fw.phase === 'finishing' && <p className="text-sm">Finishing…</p>}
        {fw.phase === 'restarting' && (
          <p className="text-sm" role="status">
            The pad is restarting and installing the update. <strong>Do not unplug it.</strong>
          </p>
        )}
        {fw.phase === 'verifying' && (
          <p className="text-sm" role="status">
            Checking the new firmware… <strong>Do not unplug the pad.</strong>
          </p>
        )}
        {fw.phase === 'done' && (
          <p className="text-sm text-ok" role="status">
            Firmware updated to {bundleVersion}.
          </p>
        )}
        {fw.phase === 'failed' && (
          <div className="flex flex-col gap-2 text-sm" role="alert">
            <p className="text-danger">{fw.error}</p>
            {!fw.committed && <p className="text-muted">The pad keeps its old firmware.</p>}
          </div>
        )}
        {fw.phase === 'cancelled' && (
          <p className="text-sm" role="status">
            Cancelled. The pad keeps its old firmware.
          </p>
        )}

        <div className="flex justify-end gap-2">
          {fw.phase === 'idle' && (
            <>
              <button
                onClick={onClose}
                className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface2"
              >
                Cancel
              </button>
              <button
                autoFocus
                onClick={fw.start}
                className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-accentfg"
              >
                Update pad
              </button>
            </>
          )}
          {CANCELLABLE.includes(fw.phase) && (
            <button
              onClick={fw.cancel}
              className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface2"
            >
              Cancel
            </button>
          )}
          {(fw.phase === 'done' || fw.phase === 'failed' || fw.phase === 'cancelled') && (
            <button
              autoFocus
              onClick={onClose}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-accentfg"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
