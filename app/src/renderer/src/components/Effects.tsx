import { useState } from 'react'
import { EFFECTS, type EffectId, type Profile } from '../../../shared/config'
import type { DeviceState } from '../../../shared/api'
import type { SyncStatus } from '../../../shared/sync'
import { EFFECTS_FIRMWARE } from '../../../shared/firmware'
import { isNewer } from '../../../shared/update'
import { PadView } from './PadView'
import { ColorPicker } from './Inspector'

type Props = {
  profiles: Profile[]
  effect: EffectId
  onEffect: (effect: EffectId) => void
  onKeyColor: (profile: number, key: number, color: string) => void
  onAllColors: (profile: number, color: string) => void
  device: DeviceState
  sync: SyncStatus
  pushing: boolean
  onPush: () => void
  onBack: () => void
}

// One small picture per effect, so the grid reads like the effect pages of other RGB software.
const GLYPHS: Record<EffectId, React.JSX.Element> = {
  static: <circle cx="24" cy="24" r="9" fill="currentColor" />,
  rainbow: (
    <>
      <path
        d="M6 34a18 18 0 0 1 36 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M13 34a11 11 0 0 1 22 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M20 34a4 4 0 0 1 8 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </>
  ),
  ripple: (
    <>
      <circle cx="24" cy="24" r="4" fill="currentColor" />
      <circle cx="24" cy="24" r="11" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle
        cx="24"
        cy="24"
        r="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.6"
      />
    </>
  ),
  starry: (
    <>
      <path
        d="M24 6l3.5 10.5L38 20l-10.5 3.5L24 34l-3.5-10.5L10 20l10.5-3.5z"
        fill="currentColor"
      />
      <circle cx="38" cy="36" r="3" fill="currentColor" />
      <circle cx="10" cy="38" r="2" fill="currentColor" />
    </>
  )
}

/** The key LED effects: pick one, and set the per-key colours the effects draw over. */
export function Effects({
  profiles,
  effect,
  onEffect,
  onKeyColor,
  onAllColors,
  device,
  sync,
  pushing,
  onPush,
  onBack
}: Props): React.JSX.Element {
  const [profile, setProfile] = useState(0)
  const [key, setKey] = useState(0)
  const connected = device.status === 'connected'
  const current = EFFECTS.find((e) => e.id === effect) ?? EFFECTS[0]
  const p = profiles[Math.min(profile, profiles.length - 1)]
  const k = p.keys[Math.min(key, p.keys.length - 1)]
  const oldFirmware = connected && !!device.firmware && isNewer(EFFECTS_FIRMWARE, device.firmware)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-bg px-4 py-2.5 shadow-sm">
        <button
          onClick={onBack}
          className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface2"
        >
          Home
        </button>
        <h1 className="text-lg font-semibold">Lighting effects</h1>
        <div className="ml-auto flex items-center gap-3">
          {sync === 'unsent' && (
            <span className="text-xs text-muted" role="status">
              Changes not on the pad yet
            </span>
          )}
          {sync === 'in-sync' && (
            <span className="text-xs text-ok" role="status">
              Pad is up to date
            </span>
          )}
          <button
            onClick={onPush}
            disabled={!connected || pushing}
            className={`rounded-md px-4 py-1.5 text-sm font-semibold disabled:opacity-40 ${sync === 'in-sync' ? 'border border-line text-fg hover:bg-surface2' : 'bg-accent text-accentfg'}`}
            title={connected ? 'Send the effect and colours to the pad' : 'Connect a pad first'}
          >
            {pushing ? 'Sending…' : 'Push to pad'}
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-wrap gap-8 overflow-y-auto p-8">
        <section
          className="flex min-w-[320px] flex-1 flex-col gap-4"
          aria-labelledby="effects-title"
        >
          <h2
            id="effects-title"
            className="text-xs font-semibold uppercase tracking-wide text-muted"
          >
            Effects
          </h2>
          {oldFirmware && (
            <p
              role="alert"
              className="rounded-md border border-line bg-surface p-3 text-sm text-muted"
            >
              This pad&apos;s firmware ({device.firmware}) is older than {EFFECTS_FIRMWARE} and does
              not play effects yet. Update the firmware from Settings on the home screen.
            </p>
          )}
          <div
            role="radiogroup"
            aria-label="Effect"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3"
          >
            {EFFECTS.map((e) => (
              <button
                key={e.id}
                role="radio"
                aria-checked={e.id === effect}
                onClick={() => onEffect(e.id)}
                className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-sm font-medium transition-colors ${e.id === effect ? 'border-accent bg-selected text-fg' : 'border-line text-muted hover:bg-surface2 hover:text-fg'}`}
              >
                <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
                  {GLYPHS[e.id]}
                </svg>
                {e.label}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted" aria-live="polite">
            {current.text}
          </p>
        </section>

        <section
          className="flex min-w-[320px] flex-1 flex-col gap-4"
          aria-labelledby="colours-title"
        >
          <h2
            id="colours-title"
            className="text-xs font-semibold uppercase tracking-wide text-muted"
          >
            {current.label}
          </h2>
          {current.colors === 'none' ? (
            <p className="rounded-md border border-line bg-surface p-3 text-sm text-muted">
              {current.label} makes its own colours, so there is nothing to set here. Your per-key
              colours are used by Static.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Profile">
                {profiles.map((pr, i) => (
                  <button
                    key={pr.id}
                    role="tab"
                    aria-selected={i === profile}
                    onClick={() => setProfile(i)}
                    className={`rounded-md px-3 py-1.5 text-sm ${i === profile ? 'bg-selected font-medium text-fg' : 'text-muted hover:bg-surface2'}`}
                  >
                    {pr.name}
                  </button>
                ))}
              </div>
              <div className="max-w-[420px]">
                <PadView
                  profile={p}
                  selection={{ kind: 'key', index: key }}
                  onSelect={(s) => s.kind === 'key' && setKey(s.index)}
                />
              </div>
              <ColorPicker
                color={k.color}
                onChange={(c) => onKeyColor(profile, key, c)}
                onApplyAll={() => onAllColors(profile, k.color)}
              />
              <p className="text-xs text-muted">
                Click a key to choose its colour. Each profile has its own colours.
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
