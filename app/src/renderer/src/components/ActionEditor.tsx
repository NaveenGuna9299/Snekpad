import { useEffect, useState } from 'react'
import {
  DEFAULT_TAP_MS,
  DEFAULT_WAIT_MS,
  MAX_COMBO,
  MAX_STEPS,
  MAX_TAP_MS,
  MAX_WAIT_MS,
  MIN_TAP_MS,
  type Action
} from '../../../shared/config'
import { CONSUMER_CODES, orderCombo, tokenFromCode } from '../lib/keys'

type Kind = Action['type']

const LABELS: Record<Kind, string> = {
  none: 'Nothing',
  fn: 'FN key',
  layer_next: 'Next profile',
  key: 'Single key',
  hotkey: 'Shortcut',
  text: 'Type text',
  sequence: 'Sequence',
  consumer: 'Media / volume',
  layer: 'Layer',
  tap_hold: 'Tap / hold'
}

const defaultFor = (k: Kind, studio: boolean): Action => {
  if (k !== 'tap_hold') return DEFAULTS[k]
  // a tap/hold key on the pad's own profile holds a plain key; in a Studio-only profile the hold goes to the layer
  return studio
    ? DEFAULTS.tap_hold
    : { type: 'tap_hold', tap: { type: 'key', key: 'ENTER' }, hold: { type: 'key', key: 'ESC' } }
}

const DEFAULTS: Record<Kind, Action> = {
  none: { type: 'none' },
  fn: { type: 'fn' },
  layer_next: { type: 'layer_next' },
  key: { type: 'key', key: 'ENTER' },
  hotkey: { type: 'hotkey', keys: ['CTRL', 'C'] },
  text: { type: 'text', text: '', enter: false },
  sequence: { type: 'sequence', steps: [{ keys: ['ESC'], wait: DEFAULT_WAIT_MS }] },
  consumer: { type: 'consumer', code: 'MUTE' },
  layer: { type: 'layer', mode: 'hold', layer: 1 },
  tap_hold: {
    type: 'tap_hold',
    tap: { type: 'key', key: 'ENTER' },
    hold: { type: 'layer', mode: 'hold', layer: 1 }
  }
}

// what a tap, a hold and a double-tap may do (a hold may also be a layer key)
const PLAIN: Kind[] = ['hotkey', 'key', 'text', 'sequence', 'consumer', 'none']
const HOLD: Kind[] = [...PLAIN, 'layer']

type Props = {
  action: Action
  allowed: Kind[]
  onChange: (a: Action) => void
  /** A Studio-only profile: layer keys and a double tap are possible. */
  studio?: boolean
  /** How many extra layers the profile has (a layer key chooses one of them). */
  layerCount?: number
}

export function ActionEditor({
  action,
  allowed,
  onChange,
  studio = false,
  layerCount = 1
}: Props): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Action" className="flex flex-col gap-1">
        <span className="text-xs text-muted">Action</span>
        <div className="grid grid-cols-3 gap-1.5">
          {allowed.map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={action.type === k}
              onClick={() => action.type !== k && onChange(defaultFor(k, studio))}
              className={`rounded-md border px-1.5 py-1.5 text-xs ${action.type === k ? 'border-accent bg-selected font-semibold text-fg' : 'border-line text-muted hover:bg-surface2 hover:text-fg'}`}
            >
              {LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      {action.type === 'hotkey' && (
        <ComboRecorder
          display={action.keys.join(' + ')}
          idle="Press and hold all the keys together, then let go"
          button="Record"
          onRecord={(keys) => onChange({ ...action, keys })}
        />
      )}

      {action.type === 'key' && (
        <TextField
          label="Key name (e.g. F5, ENTER, ESC)"
          value={action.key}
          onChange={(v) =>
            onChange({ type: 'key', key: v.toUpperCase().replace(/[^A-Z0-9_]/g, '') })
          }
        />
      )}

      {action.type === 'text' && (
        <>
          <TextField
            label="Text to type (max 80 characters)"
            value={action.text}
            maxLength={80}
            onChange={(text) => onChange({ ...action, text })}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!action.enter}
              onChange={(e) => onChange({ ...action, enter: e.target.checked })}
            />
            Press Enter afterwards
          </label>
        </>
      )}

      {action.type === 'sequence' && (
        <SequenceEditor steps={action.steps} onChange={(steps) => onChange({ ...action, steps })} />
      )}

      {action.type === 'consumer' && (
        <label className="flex flex-col gap-1 text-xs text-muted">
          Control
          <select
            value={action.code}
            onChange={(e) => onChange({ type: 'consumer', code: e.target.value })}
            className="rounded-md border border-line bg-input px-2 py-1.5 text-sm text-fg"
          >
            {CONSUMER_CODES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {action.type === 'layer' && (
        <label className="flex flex-col gap-1 text-xs text-muted">
          Layer
          <select
            value={action.layer}
            onChange={(e) => onChange({ ...action, layer: Number(e.target.value) })}
            className="rounded-md border border-line bg-input px-2 py-1.5 text-sm text-fg"
          >
            {Array.from({ length: Math.max(1, layerCount) }, (_, i) => (
              <option key={i} value={i + 1}>
                Layer {i + 2}
              </option>
            ))}
          </select>
        </label>
      )}

      {action.type === 'layer' && (
        <label className="flex flex-col gap-1 text-xs text-muted">
          How it works
          <select
            value={action.mode}
            onChange={(e) => onChange({ ...action, mode: e.target.value as 'hold' | 'toggle' })}
            className="rounded-md border border-line bg-input px-2 py-1.5 text-sm text-fg"
          >
            <option value="hold">Hold to use layer {action.layer + 1}</option>
            <option value="toggle">Press to switch to layer {action.layer + 1} and back</option>
          </select>
        </label>
      )}

      {action.type === 'tap_hold' && (
        <TapHoldEditor
          action={action}
          onChange={onChange}
          studio={studio}
          layerCount={layerCount}
        />
      )}

      {(action.type === 'hotkey' || action.type === 'sequence') && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!action.cmdOnMac}
            onChange={(e) => onChange({ ...action, cmdOnMac: e.target.checked })}
          />
          Use Cmd instead of Ctrl on macOS
        </label>
      )}
    </div>
  )
}

function TapHoldEditor({
  action,
  onChange,
  studio,
  layerCount
}: {
  action: Extract<Action, { type: 'tap_hold' }>
  onChange: (a: Action) => void
  studio: boolean
  layerCount: number
}): React.JSX.Element {
  type Part = 'hold' | 'double'
  const [more, setMore] = useState<Record<Part, boolean>>({
    hold: !!action.hold,
    double: !!action.double
  })
  // a tap_hold with neither a hold nor a double-tap is refused by the pad, so one of them is always kept
  const toggle = (part: Part, on: boolean): void => {
    const other: Part = part === 'hold' ? 'double' : 'hold'
    if (!on && !action[other]) return
    setMore({ ...more, [part]: on })
    const next = { ...action }
    if (!on) delete next[part]
    else if (part === 'hold')
      next.hold = studio ? { type: 'layer', mode: 'hold', layer: 1 } : { type: 'key', key: 'ESC' }
    else next.double = { type: 'key', key: 'ENTER' }
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-md border border-line p-2">
        <span className="text-xs font-semibold">Tap</span>
        <ActionEditor
          action={action.tap}
          allowed={PLAIN}
          onChange={(tap) => onChange({ ...action, tap: tap as typeof action.tap })}
        />
      </div>
      {(studio ? ['hold', 'double'] : ['hold'])
        .map((p) => p as Part)
        .map((part) => (
          <div key={part} className="flex flex-col gap-2 rounded-md border border-line p-2">
            <label className="flex items-center gap-2 text-xs font-semibold">
              <input
                type="checkbox"
                checked={more[part]}
                onChange={(e) => toggle(part, e.target.checked)}
              />
              {part === 'hold' ? 'Hold' : 'Double tap'}
            </label>
            {more[part] && action[part] && (
              <ActionEditor
                action={action[part]!}
                allowed={part === 'hold' && studio ? HOLD : PLAIN}
                studio={studio}
                layerCount={layerCount}
                onChange={(a) => onChange({ ...action, [part]: a })}
              />
            )}
          </div>
        ))}
      <label className="flex flex-col gap-1 text-xs text-muted">
        Hold time / double-tap window: {action.ms ?? DEFAULT_TAP_MS} ms
        <input
          type="range"
          min={MIN_TAP_MS}
          max={MAX_TAP_MS}
          step={10}
          value={action.ms ?? DEFAULT_TAP_MS}
          onChange={(e) => onChange({ ...action, ms: Number(e.target.value) })}
        />
      </label>
      {studio && more.double && (
        <p className="text-xs text-muted">
          With a double tap, a single tap fires only after the window has passed.
        </p>
      )}
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  maxLength
}: {
  label: string
  value: string
  onChange: (v: string) => void
  maxLength?: number
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <input
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-line bg-input px-2 py-1.5 text-sm text-fg"
      />
    </label>
  )
}

/**
 * Press and hold any number of keys (up to MAX_COMBO) and let go: everything held at the same
 * time is recorded. This allows Ctrl+Shift+Alt+K, two normal keys together, or modifiers only.
 */
function ComboRecorder({
  display,
  idle,
  button,
  onRecord,
  bare = false
}: {
  display: string
  idle: string
  button: string
  onRecord: (keys: string[]) => void
  bare?: boolean
}): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  const [live, setLive] = useState<string[]>([])

  useEffect(() => {
    if (!recording) return
    const order: string[] = []
    const held = new Set<string>()
    const typing = (e: KeyboardEvent): boolean =>
      e.target instanceof HTMLElement && e.target.matches('input, textarea, select')
    const down = (e: KeyboardEvent): void => {
      if (typing(e)) return // never swallow keys meant for a text field
      e.preventDefault()
      const token = tokenFromCode(e.code)
      if (!token) return
      held.add(e.code)
      if (!order.includes(token) && order.length < MAX_COMBO) order.push(token)
      setLive(orderCombo(order))
    }
    const up = (e: KeyboardEvent): void => {
      if (typing(e)) return
      e.preventDefault()
      held.delete(e.code)
      if (held.size === 0 && order.length) {
        onRecord(orderCombo(order))
        setRecording(false)
        setLive([])
      }
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording])

  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex-1 font-mono text-sm ${bare ? '' : 'rounded-md border border-line bg-input px-3 py-1.5'}`}
        aria-live="polite"
      >
        {recording ? (live.length ? live.join(' + ') : idle) : display}
      </div>
      <button
        onClick={() => {
          setRecording((r) => !r)
          setLive([])
        }}
        className={`rounded-md border border-line text-sm hover:bg-surface2 ${bare ? 'px-2 py-0.5 text-xs' : 'px-3 py-1.5'}`}
      >
        {recording ? 'Cancel' : button}
      </button>
    </div>
  )
}

type Step = Extract<Action, { type: 'sequence' }>['steps'][number]

/**
 * Up to MAX_STEPS keys or shortcuts pressed one after the other. Between two steps there is a
 * slider for the pause (in ms) before the next step starts.
 */
function SequenceEditor({
  steps,
  onChange
}: {
  steps: Step[]
  onChange: (s: Step[]) => void
}): React.JSX.Element {
  const setKeys = (i: number, keys: string[]): void =>
    onChange(steps.map((s, j) => (j === i ? { ...s, keys } : s)))
  // moving a step moves its own pause with it
  const move = (i: number, d: number): void => {
    const next = [...steps]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    onChange(next)
  }
  const setWait = (i: number, wait: number): void =>
    onChange(steps.map((s, j) => (j === i ? { ...s, wait } : s)))
  return (
    <div className="flex flex-col gap-1">
      <ol className="flex flex-col">
        {steps.map((s, i) => (
          <li key={i} className="flex flex-col">
            <div className="flex items-center gap-2 rounded-md border border-line bg-input px-3 py-1.5 font-mono text-sm">
              <span className="w-4 text-muted">{i + 1}</span>
              <ComboRecorder
                bare
                display={s.keys.join(' + ')}
                idle="Press the keys…"
                button="Re-record"
                onRecord={(keys) => setKeys(i, keys)}
              />
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`Move step ${i + 1} up`}
                className="text-muted hover:text-fg disabled:opacity-30"
              >
                ▲
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === steps.length - 1}
                aria-label={`Move step ${i + 1} down`}
                className="text-muted hover:text-fg disabled:opacity-30"
              >
                ▼
              </button>
              <button
                onClick={() => onChange(steps.filter((_, j) => j !== i))}
                disabled={steps.length === 1}
                aria-label={`Remove step ${i + 1}`}
                className="text-muted hover:text-danger disabled:opacity-30"
              >
                ✕
              </button>
            </div>
            {i < steps.length - 1 && (
              <label className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted">
                wait
                <input
                  type="range"
                  min={0}
                  max={MAX_WAIT_MS}
                  step={10}
                  value={s.wait}
                  onChange={(e) => setWait(i, Number(e.target.value))}
                  aria-label={`Pause between step ${i + 1} and step ${i + 2}, in milliseconds`}
                  className="flex-1 accent-[var(--accent)]"
                />
                <span className="w-14 text-right font-mono text-fg">{s.wait} ms</span>
              </label>
            )}
          </li>
        ))}
      </ol>
      {steps.length < MAX_STEPS ? (
        <ComboRecorder
          display={`Add step ${steps.length + 1} of ${MAX_STEPS}…`}
          idle="Press the next key or shortcut"
          button="Add step"
          onRecord={(keys) => onChange([...steps, { keys, wait: DEFAULT_WAIT_MS }])}
        />
      ) : (
        <p className="text-xs text-muted">A sequence can have at most {MAX_STEPS} steps.</p>
      )}
    </div>
  )
}
