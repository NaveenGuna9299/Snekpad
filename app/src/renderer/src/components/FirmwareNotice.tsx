import type { DeviceState } from '../../../shared/api'
import { firmwareNotice, firmwareStatus, updateOffer } from '../../../shared/firmware'

type Props = {
  device: DeviceState
  /** The firmware version inside this build of Studio, or null if this build carries none. */
  bundleVersion: string | null
  /** Hide the notice until the pad is plugged in again. */
  onDismiss: () => void
  /** Open the firmware update dialog. */
  onUpdate: () => void
}

/**
 * A strip when the pad's firmware is older than this app's. A pad that can take the update from Studio gets an
 * "Update pad" button; one that is too old to do that is pointed to the one-time flash from the computer.
 * Renders nothing when the pad is up to date.
 */
export function FirmwareNotice({
  device,
  bundleVersion,
  onDismiss,
  onUpdate
}: Props): React.JSX.Element | null {
  const offer = updateOffer(device, bundleVersion)
  if (offer === 'none' && firmwareStatus(device) !== 'older') return null
  const padIs = device.firmware ? `Pad firmware ${device.firmware}` : 'This pad’s firmware'
  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-line bg-surface2 px-4 py-2 text-sm"
    >
      <span className="min-w-0 flex-1">
        {offer === 'ota' && (
          <>
            {padIs} is older than the firmware in this app ({bundleVersion}).{' '}
            <button onClick={onUpdate} className="font-semibold text-accent underline">
              Update pad
            </button>
          </>
        )}
        {offer === 'manual' && (
          <>
            {firmwareStatus(device) === 'older'
              ? firmwareNotice(device)
              : `${padIs} is older than the firmware in this app (${bundleVersion}).`}{' '}
            It cannot update itself yet: it needs one flash from the computer, and after that
            updates run from Studio.{' '}
            <button
              onClick={() => void window.api.openReleasePage()}
              className="font-semibold text-accent underline"
            >
              Open the release page
            </button>{' '}
            for the steps.
          </>
        )}
        {offer === 'none' && (
          <>
            {firmwareNotice(device)}{' '}
            <button
              onClick={() => void window.api.openReleasePage()}
              className="font-semibold text-accent underline"
            >
              Open the release page
            </button>{' '}
            for the update steps.
          </>
        )}
      </span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss firmware warning"
        className="text-muted hover:text-fg"
      >
        ✕
      </button>
    </div>
  )
}
