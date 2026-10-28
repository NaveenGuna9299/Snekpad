import { useState } from 'react'
import {
  FN_KEY,
  LABEL_MAX,
  MAX_TITLE_WORDS,
  TITLE_WORD_MAX,
  type Action,
  type KeyConfig,
  type Profile
} from '../../../shared/config'
import { COLOR_PRESETS } from '../lib/keys'
import { ActionEditor } from './ActionEditor'
import { ProgramPicker } from './ProgramPicker'
import type { Selection } from './PadView'

type Props = {
  profile: Profile
  selection: Selection
  onKey: (index: number, patch: Partial<KeyConfig>) => void
  onEncoder: (patch: Partial<Profile['encoder']>) => void
  onMatch: (windows: string[], macos: string[]) => void
  /** The words that switch to the profile when they are in a window's title. */
  onTitles: (titles: string[]) => void
  onApplyColorToAll: (color: string) => void
  /** The profile is a Studio-only one: it may have layers, layer keys and a double tap. */
  studio?: boolean
  /** The keys shown are those of an extra layer, which can go back to the main keys. */
  inLayer?: boolean
}

const KEY_ACTIONS: Action['type'][] = [
  'hotkey',
  'key',
  'text',
  'sequence',
  'consumer',
  'tap_hold',
  'none'
]
// a layer key is for Studio-only profiles (the pad's own profiles have no layers)
const STUDIO_KEY_ACTIONS: Action['type'][] = [
  'hotkey',
  'key',
  'text',
  'sequence',
  'consumer',
  'tap_hold',
  'layer',
  'none'
]
const ENC_ACTIONS: Action['type'][] = ['consumer', 'hotkey', 'key', 'none']

export function Inspector({
  profile,
  selection,
  onKey,
  onEncoder,
  onMatch,
  onTitles,
  onApplyColorToAll,
  studio = false,
  inLayer = false
}: Props): React.JSX.Element {
  return (
    <div className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-line bg-surface p-4">
      {selection.kind === 'key' ? (
        <KeyPanel
          studio={studio}
          inLayer={inLayer}
          profile={profile}
          index={selection.index}
          onKey={onKey}
          onApplyColorToAll={onApplyColorToAll}
        />
      ) : (
        <EncoderPanel profile={profile} onEncoder={onEncoder} />
      )}

      <section className="flex flex-col gap-2 border-t border-line pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Switch to this profile when…
        </h3>
        {profile.id === 'general' ? (
          <p className="text-sm text-muted">
            General is used for every app that has no profile of its own.
          </p>
        ) : (
          <>
            <ProgramPicker
              windows={profile.match.windows}
              macos={profile.match.macos}
              onChange={onMatch}
            />
            <TitleWords words={profile.match.titles} onChange={onTitles} />
          </>
        )}
      </section>
    </div>
  )
}

/** Words that switch to the profile when a window's title contains them: one website or document inside any program. */
export function TitleWords({
  words,
  onChange
}: {
  words: string[]
  onChange: (words: string[]) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const word = draft.trim().slice(0, TITLE_WORD_MAX)
  const known = words.some((w) => w.toLowerCase() === word.toLowerCase())
  const full = words.length >= MAX_TITLE_WORDS
  const add = (): void => {
    if (!word || known || full) return
    onChange([...words, word])
    setDraft('')
  }
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <span className="text-xs text-muted">…or when the window title contains</span>
      {words.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Title words">
          {words.map((w) => (
            <li
              key={w}
              className="flex items-center gap-1 rounded-md border border-line bg-surface2 py-0.5 pl-2 pr-1 text-sm"
            >
              {w}
              <button
                onClick={() => onChange(words.filter((x) => x !== w))}
                aria-label={`Remove ${w}`}
                className="rounded px-1 text-muted hover:bg-surface hover:text-fg"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          value={draft}
          maxLength={TITLE_WORD_MAX}
          disabled={full}
          placeholder={full ? `At most ${MAX_TITLE_WORDS} words` : 'e.g. YouTube, Gmail, Figma'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          aria-label="Word in the window title"
          className="min-w-0 flex-1 rounded-md border border-line bg-input px-2 py-1.5 text-sm text-fg disabled:opacity-60"
        />
        <button
          onClick={add}
          disabled={!word || known || full}
          className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add
        </button>
      </div>
      <p className="text-xs text-muted">
        Works in any program, so you can have a profile for one website or document: a browser shows
        the site&apos;s name in its title bar. Capitals do not matter. When two profiles fit the
        same window, the one that matches a title word wins over one that only matches the program,
        and one that matches both wins over either.
      </p>
    </div>
  )
}

export function KeyPanel({
  profile,
  index,
  onKey,
  onApplyColorToAll,
  studio = false,
  inLayer = false
}: {
  studio?: boolean
  /** The keys shown are those of an extra layer. */
  inLayer?: boolean
  profile: Profile
  index: number
  onKey: Props['onKey']
  onApplyColorToAll: Props['onApplyColorToAll']
}): React.JSX.Element {
  const key = profile.keys[index]
  const row = Math.floor(index / 4) + 1
  const col = (index % 4) + 1
  const isFn = index === FN_KEY
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-base font-semibold">
        Key {index + 1}{' '}
        <span className="text-sm font-normal text-muted">
          row {row}, column {col}
        </span>
      </h3>

      {isFn ? (
        <p className="text-sm text-muted">
          This key opens the utility layer (bootloader, LED brightness, jump to profile) while held.
          It can only change colour.
        </p>
      ) : (
        <label className="flex flex-col gap-1 text-xs text-muted">
          <FieldLabel text="Label on the pad's screen" value={key.label} max={LABEL_MAX} />
          <input
            value={key.label}
            maxLength={LABEL_MAX}
            onChange={(e) => onKey(index, { label: e.target.value })}
            className="rounded-md border border-line bg-input px-2 py-1.5 font-mono text-sm text-fg"
          />
        </label>
      )}

      <ColorPicker
        color={key.color}
        onChange={(color) => onKey(index, { color })}
        onApplyAll={() => onApplyColorToAll(key.color)}
      />

      {!isFn && (
        <ActionEditor
          action={key.action}
          allowed={studio ? STUDIO_KEY_ACTIONS : KEY_ACTIONS}
          studio={studio}
          layerCount={profile.layers.length}
          inLayer={inLayer}
          onChange={(action) => onKey(index, { action })}
        />
      )}
    </section>
  )
}

export function EncoderPanel({
  profile,
  onEncoder
}: {
  profile: Profile
  onEncoder: Props['onEncoder']
}): React.JSX.Element {
  const e = profile.encoder
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-base font-semibold">Rotary encoder</h3>
      <label className="flex flex-col gap-1 text-xs text-muted">
        <FieldLabel text="Hint on the pad's screen" value={e.label} max={10} />
        <input
          value={e.label}
          maxLength={10}
          onChange={(ev) => onEncoder({ label: ev.target.value.toUpperCase() })}
          className="rounded-md border border-line bg-input px-2 py-1.5 font-mono text-sm text-fg"
        />
      </label>
      <Group title="Turn right">
        <ActionEditor action={e.cw} allowed={ENC_ACTIONS} onChange={(cw) => onEncoder({ cw })} />
      </Group>
      <Group title="Turn left">
        <ActionEditor action={e.ccw} allowed={ENC_ACTIONS} onChange={(ccw) => onEncoder({ ccw })} />
      </Group>
      <Group title="Short press">
        <label className="flex flex-col gap-1 text-xs text-muted">
          <FieldLabel text="Label while the knob is held" value={e.pressLabel} max={LABEL_MAX} />
          <input
            value={e.pressLabel}
            maxLength={LABEL_MAX}
            onChange={(ev) => onEncoder({ pressLabel: ev.target.value.toUpperCase() })}
            className="rounded-md border border-line bg-input px-2 py-1.5 font-mono text-sm text-fg"
          />
        </label>
        <ActionEditor
          action={e.press}
          allowed={ENC_ACTIONS}
          onChange={(press) => onEncoder({ press })}
        />
      </Group>
      <p className="text-xs text-muted">
        Press and release quickly to run the short press. Hold the knob for half a second to open
        the profile switcher: turn to choose, press to confirm, hold to cancel.
      </p>
    </section>
  )
}

/** A field caption with a live "n/max" counter, so a cut-off label is never a surprise. */
function FieldLabel({
  text,
  value,
  max
}: {
  text: string
  value: string
  max: number
}): React.JSX.Element {
  return (
    <span className="flex justify-between">
      <span>{text}</span>
      <span
        className={value.length >= max ? 'font-semibold text-fg' : ''}
        aria-label={`${value.length} of ${max} characters`}
      >
        {value.length}/{max}
      </span>
    </span>
  )
}

function Group({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-line p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </legend>
      {children}
    </fieldset>
  )
}

export function ColorPicker({
  color,
  onChange,
  onApplyAll
}: {
  color: string
  onChange: (c: string) => void
  /** The button that copies the colour to every key; left out where there is nothing to copy it to. */
  onApplyAll?: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted">LED colour</span>
      <div className="flex flex-wrap gap-1.5">
        {COLOR_PRESETS.map((c) => (
          <button
            key={c}
            onClick={() => onChange(c)}
            aria-label={`Colour ${c}`}
            aria-pressed={c.toLowerCase() === color.toLowerCase()}
            className="h-7 w-7 rounded-md border border-line"
            style={{
              background: c,
              outline:
                c.toLowerCase() === color.toLowerCase() ? '2px solid var(--accent)' : undefined,
              outlineOffset: 2
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={color}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          aria-label="Pick a colour"
          className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent"
        />
        <input
          value={color}
          maxLength={7}
          onChange={(e) =>
            /^#[0-9a-fA-F]{6}$/.test(e.target.value) && onChange(e.target.value.toUpperCase())
          }
          className="w-24 rounded-md border border-line bg-input px-2 py-1.5 font-mono text-sm text-fg"
          aria-label="Hex colour"
        />
        {onApplyAll && (
          <button
            onClick={onApplyAll}
            className="ml-auto rounded-md border border-line px-2 py-1.5 text-xs hover:bg-surface2"
          >
            Apply to all keys
          </button>
        )}
      </div>
    </div>
  )
}
