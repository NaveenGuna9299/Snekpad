import { FN_KEY, LABEL_MAX, type Action, type KeyConfig, type Profile } from '../../../shared/config'
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
  onApplyColorToAll: (color: string) => void
}

const KEY_ACTIONS: Action['type'][] = ['hotkey', 'key', 'text', 'sequence', 'consumer', 'none']
const ENC_ACTIONS: Action['type'][] = ['consumer', 'hotkey', 'key', 'none']

export function Inspector({ profile, selection, onKey, onEncoder, onMatch, onApplyColorToAll }: Props): React.JSX.Element {
  return (
    <div className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-line bg-surface p-4">
      {selection.kind === 'key' ? (
        <KeyPanel profile={profile} index={selection.index} onKey={onKey} onApplyColorToAll={onApplyColorToAll} />
      ) : (
        <EncoderPanel profile={profile} onEncoder={onEncoder} />
      )}

      <section className="flex flex-col gap-2 border-t border-line pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Switch to this profile when…</h3>
        {profile.id === 'general' ? (
          <p className="text-sm text-muted">General is used for every app that has no profile of its own.</p>
        ) : (
          <ProgramPicker windows={profile.match.windows} macos={profile.match.macos} onChange={onMatch} />
        )}
      </section>
    </div>
  )
}

export function KeyPanel({ profile, index, onKey, onApplyColorToAll }: { profile: Profile; index: number; onKey: Props['onKey']; onApplyColorToAll: Props['onApplyColorToAll'] }): React.JSX.Element {
  const key = profile.keys[index]
  const row = Math.floor(index / 4) + 1
  const col = (index % 4) + 1
  const isFn = index === FN_KEY
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-base font-semibold">Key {index + 1} <span className="text-sm font-normal text-muted">row {row}, column {col}</span></h3>

      {isFn ? (
        <p className="text-sm text-muted">This key opens the utility layer (bootloader, LED brightness, jump to profile) while held. It can only change colour.</p>
      ) : (
        <label className="flex flex-col gap-1 text-xs text-muted">
          Label on the pad's screen (max {LABEL_MAX} characters)
          <input value={key.label} maxLength={LABEL_MAX} onChange={(e) => onKey(index, { label: e.target.value })} className="rounded-md border border-line bg-input px-2 py-1.5 font-mono text-sm text-fg" />
        </label>
      )}

      <ColorPicker color={key.color} onChange={(color) => onKey(index, { color })} onApplyAll={() => onApplyColorToAll(key.color)} />

      {!isFn && <ActionEditor action={key.action} allowed={KEY_ACTIONS} onChange={(action) => onKey(index, { action })} />}
    </section>
  )
}

export function EncoderPanel({ profile, onEncoder }: { profile: Profile; onEncoder: Props['onEncoder'] }): React.JSX.Element {
  const e = profile.encoder
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-base font-semibold">Rotary encoder</h3>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Hint on the pad's screen (max 10 characters)
        <input value={e.label} maxLength={10} onChange={(ev) => onEncoder({ label: ev.target.value.toUpperCase() })} className="rounded-md border border-line bg-input px-2 py-1.5 font-mono text-sm text-fg" />
      </label>
      <Group title="Turn right"><ActionEditor action={e.cw} allowed={ENC_ACTIONS} onChange={(cw) => onEncoder({ cw })} /></Group>
      <Group title="Turn left"><ActionEditor action={e.ccw} allowed={ENC_ACTIONS} onChange={(ccw) => onEncoder({ ccw })} /></Group>
      <Group title="Short press">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Label while the knob is held (max {LABEL_MAX} characters)
          <input value={e.pressLabel} maxLength={LABEL_MAX} onChange={(ev) => onEncoder({ pressLabel: ev.target.value.toUpperCase() })} className="rounded-md border border-line bg-input px-2 py-1.5 font-mono text-sm text-fg" />
        </label>
        <ActionEditor action={e.press} allowed={ENC_ACTIONS} onChange={(press) => onEncoder({ press })} />
      </Group>
      <p className="text-xs text-muted">Press and release quickly to run the short press. Hold the knob for half a second to open the profile switcher: turn to choose, press to confirm, hold to cancel.</p>
    </section>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-line p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</legend>
      {children}
    </fieldset>
  )
}

function ColorPicker({ color, onChange, onApplyAll }: { color: string; onChange: (c: string) => void; onApplyAll: () => void }): React.JSX.Element {
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
            style={{ background: c, outline: c.toLowerCase() === color.toLowerCase() ? '2px solid var(--accent)' : undefined, outlineOffset: 2 }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input type="color" value={color} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label="Pick a colour" className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent" />
        <input value={color} maxLength={7} onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && onChange(e.target.value.toUpperCase())} className="w-24 rounded-md border border-line bg-input px-2 py-1.5 font-mono text-sm text-fg" aria-label="Hex colour" />
        <button onClick={onApplyAll} className="ml-auto rounded-md border border-line px-2 py-1.5 text-xs hover:bg-surface2">Apply to all keys</button>
      </div>
    </div>
  )
}
