import { useState } from 'react'
import { EFFECTS, isMusicEffect, type EffectId, type Profile } from '../../../shared/config'
import type { DeviceState } from '../../../shared/api'
import type { SyncStatus } from '../../../shared/sync'
import { EFFECTS_FIRMWARE } from '../../../shared/firmware'
import { isNewer } from '../../../shared/update'
import { PadView } from './PadView'
import { ColorPicker } from './Inspector'
import type { MusicState } from '../lib/useMusic'

type Props = {
  profiles: Profile[]
  effect: EffectId
  onEffect: (effect: EffectId) => void
  /** What Studio is hearing, for the music effects. */
  music: MusicState
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
  equalizer: (
    <>
      <rect x="7" y="22" width="7" height="20" rx="2" fill="currentColor" />
      <rect x="17" y="10" width="7" height="32" rx="2" fill="currentColor" />
      <rect x="27" y="16" width="7" height="26" rx="2" fill="currentColor" />
      <rect x="37" y="28" width="7" height="14" rx="2" fill="currentColor" />
    </>
  ),
  beat: (
    <>
      <path
        d="M4 26h9l4-11 6 22 5-17 3 6h13"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="24"
        cy="24"
        r="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.5"
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
  music,
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
          {isMusicEffect(effect) ? (
            <MusicPanel music={music} connected={connected} />
          ) : current.colors === 'none' ? (
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

const BAND_NAMES = ['Bass', 'Low', 'High', 'Treble']

/** What Studio hears while a music effect is chosen: a small version of the lights, so it is clear it is working. */
function MusicPanel({
  music,
  connected
}: {
  music: MusicState
  connected: boolean
}): React.JSX.Element {
  const text = !connected
    ? 'Connect your pad: Studio sends it the music while the pad is connected.'
    : music.status === 'listening'
      ? 'Listening to the sound your computer plays.'
      : music.status === 'starting'
        ? 'Starting to listen…'
        : music.status === 'error'
          ? (music.error ?? 'Studio could not listen to the sound.')
          : 'Studio listens once the pad is connected.'
  return (
    <div className="flex flex-col gap-3">
      <p
        role="status"
        className={`rounded-md border border-line bg-surface p-3 text-sm ${music.status === 'error' ? 'text-danger' : 'text-muted'}`}
      >
        {text}
      </p>
      <div className="flex items-end gap-3" aria-label="What Studio hears" role="img">
        {BAND_NAMES.map((name, i) => (
          <div key={name} className="flex flex-col items-center gap-1">
            <div className="flex h-24 w-9 items-end overflow-hidden rounded-md border border-line bg-input">
              <div
                data-testid={`band-${i}`}
                className="w-full bg-accent transition-[height] duration-100"
                style={{ height: `${Math.round((music.bands[i] / 63) * 100)}%` }}
              />
            </div>
            <span className="text-xs text-muted">{name}</span>
          </div>
        ))}
        <div className="flex flex-col items-center gap-1">
          <div className="flex h-24 w-9 items-center justify-center rounded-md border border-line bg-input">
            <span
              data-testid="beat-dot"
              className={`h-4 w-4 rounded-full ${music.beat > 0 ? 'bg-accent' : 'bg-line'}`}
            />
          </div>
          <span className="text-xs text-muted">Beat</span>
        </div>
      </div>
      <p className="text-xs text-muted">
        Keep Studio open (you can minimise it). Push to pad after choosing the effect. It listens to
        the computer&apos;s own sound, so it needs Windows and no microphone.
      </p>
    </div>
  )
}
