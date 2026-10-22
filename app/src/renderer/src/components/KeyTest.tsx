import { useEffect, useState } from 'react'
import { FN_KEY, KEY_COUNT, type Profile } from '../../../shared/config'
import type { DeviceState } from '../../../shared/api'
import { hasDevTools } from '../../../shared/firmware'
import type { KnobAction } from '../../../shared/protocol'
import { PadView } from './PadView'

type Props = {
  /** The profile drawn on screen (colours and labels only; the test does not depend on it). */
  profile: Profile
  device: DeviceState
  /** Keys the pad reports as held right now. */
  pressed: ReadonlySet<number>
  onBack: () => void
}

const NOT_SELECTED = { kind: 'key', index: -1 } as const
const emptyCounts = (): number[] => Array.from({ length: KEY_COUNT }, () => 0)
const emptyKnob = (): Record<KnobAction, number> => ({ cw: 0, ccw: 0, press: 0 })
const KNOB_ROWS: { action: KnobAction; label: string }[] = [
  { action: 'cw', label: 'Turn right' },
  { action: 'ccw', label: 'Turn left' },
  { action: 'press', label: 'Press' }
]

/**
 * Press every key and use the knob, and watch it register here. For checking a new pad, and for
 * diagnosing one remotely ("which keys does the app see?"). It counts what the pad reports (`EVT key`
 * and `EVT knob`), so it needs firmware that speaks protocol 2.
 */
export function KeyTest({ profile, device, pressed, onBack }: Props): React.JSX.Element {
  const [counts, setCounts] = useState<number[]>(emptyCounts)
  const [knob, setKnob] = useState<Record<KnobAction, number>>(emptyKnob)
  const connected = device.status === 'connected'
  const reporting = connected && device.events === true
  const devPad = hasDevTools(device) // flashed with flash_pad.ps1 -Dev: silences its keys and reports the knob

  // the pad types its shortcuts into this window: have the main process ignore them while we are open
  useEffect(() => {
    void window.api.setKeyTest(true)
    return () => void window.api.setKeyTest(false)
  }, [])

  useEffect(() => {
    return window.api.onDeviceEvent((e) => {
      if (e.kind === 'knob') setKnob((k) => ({ ...k, [e.action]: k[e.action] + 1 }))
      else if (e.down) setCounts((c) => c.map((n, i) => (i === e.index ? n + 1 : n)))
    })
  }, [])

  const tested = counts.filter((n) => n > 0).length
  const knobTested = KNOB_ROWS.filter((r) => knob[r.action] > 0).length
  const reset = (): void => {
    setCounts(emptyCounts())
    setKnob(emptyKnob())
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col items-center gap-5 overflow-y-auto p-8">
      <div className="flex w-full max-w-[560px] items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface2"
        >
          Back
        </button>
        <h1 className="text-2xl font-bold tracking-tight">Key test</h1>
        <button
          onClick={reset}
          className="ml-auto rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface2"
        >
          Reset
        </button>
      </div>

      <p className="w-full max-w-[560px] text-sm text-muted" role="status" aria-live="polite">
        {!connected
          ? 'No pad found. Plug in your SnekPad to test its keys.'
          : !reporting
            ? 'This pad does not report key presses. Update its firmware to use the key test.'
            : 'Press each key and use the knob. Each one lights up below and is ticked off once the app has seen it.'}
      </p>

      {reporting && !devPad && (
        <p
          role="alert"
          className="w-full max-w-[560px] rounded-md border border-danger/50 px-3 py-2 text-sm text-danger"
        >
          This pad is not a development flash, so it cannot silence its keys during the test: each
          key still does its normal job on this computer (key 10, for example, may close a window),
          and the knob is not reported. Flash the pad with flash_pad.ps1 -Dev to test safely.
        </p>
      )}

      <PadView profile={profile} selection={NOT_SELECTED} onSelect={() => {}} pressed={pressed} />

      <p className="text-sm font-semibold" aria-live="polite">
        {tested} of {KEY_COUNT} keys tested
        {reporting && tested === KEY_COUNT && ' — all keys work'}
      </p>

      <ul aria-label="Key results" className="grid w-full max-w-[560px] grid-cols-4 gap-2 text-sm">
        {counts.map((n, i) => (
          <li
            key={i}
            data-testid={`key-result-${i}`}
            className={`flex items-center justify-between rounded-md border px-3 py-2 ${pressed.has(i) ? 'border-accent bg-selected' : 'border-line'}`}
          >
            <span>{i === FN_KEY ? 'FN' : `Key ${i + 1}`}</span>
            <span className={n > 0 ? 'font-semibold text-ok' : 'text-muted'}>
              {n > 0 ? `✓ ${n}` : '–'}
            </span>
          </li>
        ))}
      </ul>

      <section aria-label="Knob" className="flex w-full max-w-[560px] flex-col gap-2">
        <p className="text-sm font-semibold" aria-live="polite">
          Knob: {knobTested} of {KNOB_ROWS.length} actions tested
        </p>
        <ul className="grid grid-cols-3 gap-2 text-sm">
          {KNOB_ROWS.map(({ action, label }) => (
            <li
              key={action}
              data-testid={`knob-result-${action}`}
              className="flex items-center justify-between rounded-md border border-line px-3 py-2"
            >
              <span>{label}</span>
              <span className={knob[action] > 0 ? 'font-semibold text-ok' : 'text-muted'}>
                {knob[action] > 0 ? `✓ ${knob[action]}` : '–'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="max-w-[560px] text-xs text-muted">
        Development tool: not in the production Studio. While this screen is open a development pad
        types nothing on the computer, and Studio also ignores shortcuts such as Ctrl+W as a second
        safeguard.
      </p>
    </main>
  )
}
