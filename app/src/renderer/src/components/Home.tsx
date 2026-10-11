import type { Profile } from '../../../shared/config'
import type { DeviceState } from '../../../shared/api'
import { PadView } from './PadView'
import { SettingsMenu } from './SettingsMenu'

type Props = {
  profile: Profile
  device: DeviceState
  profileCount: number
  onOpen: () => void
  /** Name of the profile the pad reports running; undefined if it does not report one. */
  padProfileName?: string
  pressed?: ReadonlySet<number>
  mock: boolean
  onMock: (on: boolean) => void
  onReset: () => void
}

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good Morning' : h < 18 ? 'Good Afternoon' : 'Good Evening'
}

/** The start screen: a greeting and the pad with its status, like Logi Options+. */
export function Home({
  profile,
  device,
  profileCount,
  onOpen,
  padProfileName,
  pressed,
  mock,
  onMock,
  onReset
}: Props): React.JSX.Element {
  const connected = device.status === 'connected'
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-10">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-4xl font-bold tracking-tight">{greeting()}</h1>
        <SettingsMenu mock={mock} onMock={onMock} onReset={onReset} />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <button
          onClick={onOpen}
          aria-label="Open SnekPad settings"
          title="Click to customize"
          className="w-full max-w-[460px] cursor-pointer rounded-3xl drop-shadow-[0_18px_40px_rgba(0,0,0,0.55)] transition-transform duration-150 hover:scale-[1.03] active:scale-100"
        >
          <span className="pointer-events-none block" aria-hidden="true">
            <PadView
              profile={profile}
              selection={{ kind: 'key', index: -1 }}
              onSelect={() => {}}
              pressed={pressed}
            />
          </span>
        </button>

        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-md border border-line bg-input px-3 py-2 text-sm font-semibold"
        >
          <span className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-ok' : 'bg-muted'}`} />
          <span className={connected ? 'text-ok' : 'text-muted'}>
            {connected ? (device.label ?? 'SnekPad') : 'Not connected'}
          </span>
        </div>
        <p className="text-sm text-muted">
          {profileCount} profile{profileCount === 1 ? '' : 's'} ·{' '}
          {padProfileName ? `on the pad: ${padProfileName}` : `showing: ${profile.name}`}
        </p>
      </div>
    </main>
  )
}
