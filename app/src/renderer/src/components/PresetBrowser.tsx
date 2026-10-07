import { useEffect, useState } from 'react'
import { COLS, MAX_PROFILES, type KeyConfig, type Profile } from '../../../shared/config'
import { describeAction } from '../lib/describe'
import { PRESETS, type Preset } from '../lib/presets'
import { chipsFor } from '../lib/programs'
import { ProgramIcon } from './ProgramIcon'
import { EncoderPanel, KeyPanel } from './Inspector'
import type { Selection } from './PadView'

type Props = {
  current: Profile // the profile that "Save current" stores
  profileCount: number
  currentName: string
  canReplace: boolean // General cannot be replaced
  onAdd: (p: Preset) => void
  onReplace: (p: Preset) => void
  onClose: () => void
}

const newId = (): string => `mine${Date.now().toString(36)}`

/** A window of ready-made profiles: pick an app, preview its keys, add it or swap it in. */
export function PresetBrowser({
  current,
  profileCount,
  currentName,
  canReplace,
  onAdd,
  onReplace,
  onClose
}: Props): React.JSX.Element {
  const [picked, setPicked] = useState<Preset>(PRESETS[0])
  const [draft, setDraft] = useState<Preset>(PRESETS[0]) // picked, plus the user's edits
  const [sel, setSel] = useState<Selection | null>(null)
  const [mine, setMine] = useState<Preset[]>([])
  const [saveName, setSaveName] = useState(currentName)
  const [error, setError] = useState('')
  const full = profileCount >= MAX_PROFILES

  useEffect(() => {
    window.api.loadTemplates().then(setMine)
  }, [])

  const persist = (list: Preset[]): void => {
    setError('')
    window.api.saveTemplates(list).then(setMine, () => setError('Could not save your profiles.'))
  }

  const saveCurrent = (): void => {
    const name = saveName.trim().slice(0, 12)
    if (!name) return
    const copy: Partial<Profile> = structuredClone(current)
    delete copy.id
    const t: Preset = {
      id: newId(),
      name,
      note: 'Saved by you',
      profile: { ...(copy as Omit<Profile, 'id'>), name }
    }
    persist([...mine, t])
    pick(t)
  }

  const pick = (p: Preset): void => {
    setPicked(p)
    setDraft(structuredClone(p))
    setSel(null)
  }

  const editKey = (index: number, patch: Partial<KeyConfig>): void =>
    setDraft((d) => ({
      ...d,
      profile: {
        ...d.profile,
        keys: d.profile.keys.map((k, i) => (i === index ? { ...k, ...patch } : k))
      }
    }))

  const dirty = JSON.stringify(draft) !== JSON.stringify(picked)

  /** Keep the edits: update a saved profile in place, or save a ready-made one as a new copy. */
  const saveDraft = (): void => {
    const name = draft.name.trim() || picked.name
    const next: Preset = isMine
      ? { ...draft, name, profile: { ...draft.profile, name } }
      : { ...draft, id: newId(), name, note: 'Saved by you', profile: { ...draft.profile, name } }
    persist(isMine ? mine.map((m) => (m.id === picked.id ? next : m)) : [...mine, next])
    setPicked(next)
    setDraft(structuredClone(next))
  }

  const remove = (t: Preset): void => {
    persist(mine.filter((m) => m.id !== t.id))
    pick(PRESETS[0])
  }

  const isMine = mine.some((m) => m.id === picked.id)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="More profiles"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-line bg-bg shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">More profiles</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded px-2 py-1 text-muted hover:bg-surface2 hover:text-fg"
          >
            ✕
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line p-4">
            <Tiles title="Ready-made" items={PRESETS} picked={picked} onPick={pick} />
            <Tiles
              title="My profiles"
              items={mine}
              picked={picked}
              onPick={pick}
              empty="Nothing saved yet."
            />

            <form
              className="mt-auto flex flex-col gap-1.5 border-t border-line pt-3"
              onSubmit={(e) => {
                e.preventDefault()
                saveCurrent()
              }}
            >
              <label className="flex flex-col gap-1 text-xs text-muted">
                Save “{currentName}” for later
                <input
                  value={saveName}
                  maxLength={12}
                  onChange={(e) => setSaveName(e.target.value)}
                  className="rounded-md border border-line bg-input px-2 py-1.5 text-sm text-fg"
                />
              </label>
              <button
                type="submit"
                disabled={!saveName.trim()}
                className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface2 disabled:opacity-40"
              >
                Save to My profiles
              </button>
              {error && (
                <p role="alert" className="text-xs text-danger">
                  {error}
                </p>
              )}
            </form>
          </div>

          <section className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold">{draft.name}</h3>
                <p className="text-sm text-muted">{picked.note}</p>
              </div>
              <label className="flex shrink-0 flex-col gap-1 text-xs text-muted">
                Name
                <input
                  value={draft.name}
                  maxLength={12}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      name: e.target.value,
                      profile: { ...d.profile, name: e.target.value }
                    }))
                  }
                  className="w-32 rounded-md border border-line bg-input px-2 py-1 text-sm text-fg"
                />
              </label>
            </div>

            <div className="flex gap-4">
              <div className="min-w-0 flex-1">
                <div className="grid grid-cols-4 gap-2" aria-label="Keys">
                  {draft.profile.keys.map((k, i) => (
                    <button
                      key={i}
                      onClick={() => setSel({ kind: 'key', index: i })}
                      aria-pressed={sel?.kind === 'key' && sel.index === i}
                      title={describeAction(k.action)}
                      className={`flex h-14 items-center justify-center rounded-md border bg-surface font-mono text-xs hover:bg-surface2 ${sel?.kind === 'key' && sel.index === i ? 'border-accent' : 'border-line'}`}
                      style={{ borderBottom: `4px solid ${k.color}` }}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setSel({ kind: 'encoder' })}
                  aria-pressed={sel?.kind === 'encoder'}
                  className={`mt-2 rounded-md border px-2 py-1 text-xs text-muted hover:bg-surface2 ${sel?.kind === 'encoder' ? 'border-accent' : 'border-line'}`}
                >
                  Knob: {draft.profile.encoder.label.replace('KNOB:', '').toLowerCase()} on turn,{' '}
                  {draft.profile.encoder.pressLabel.toLowerCase() || 'nothing'} on press
                </button>
                <p className="mt-1 text-xs text-muted">
                  {COLS} keys per row. Click a key or the knob to edit it.
                </p>
              </div>

              {sel && (
                <div className="w-72 shrink-0 rounded-md border border-line bg-surface p-3">
                  {sel.kind === 'key' ? (
                    <KeyPanel
                      profile={{ ...draft.profile, id: 'draft' }}
                      index={sel.index}
                      onKey={editKey}
                      onApplyColorToAll={(color) =>
                        setDraft((d) => ({
                          ...d,
                          profile: {
                            ...d.profile,
                            keys: d.profile.keys.map((k) => ({ ...k, color }))
                          }
                        }))
                      }
                    />
                  ) : (
                    <EncoderPanel
                      profile={{ ...draft.profile, id: 'draft' }}
                      onEncoder={(patch) =>
                        setDraft((d) => ({
                          ...d,
                          profile: { ...d.profile, encoder: { ...d.profile.encoder, ...patch } }
                        }))
                      }
                    />
                  )}
                </div>
              )}
            </div>

            <p className="text-sm text-muted">
              {draft.profile.match.windows.length || draft.profile.match.titles.length
                ? `Switches on: ${[...chipsFor(draft.profile.match.windows).map((c) => c.name), ...draft.profile.match.titles.map((t) => `"${t}" in title`)].join(', ')}`
                : 'No app switches to this one. Reach it from the profile switcher.'}
            </p>

            <div className="mt-auto flex flex-wrap gap-2">
              <button
                disabled={full}
                onClick={() => onAdd(draft)}
                title={full ? 'The pad holds at most 4 profiles. Replace one instead.' : undefined}
                className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accentfg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add as new profile
              </button>
              <button
                disabled={!canReplace}
                onClick={() => onReplace(draft)}
                title={
                  canReplace
                    ? undefined
                    : 'General cannot be replaced. Select another profile first.'
                }
                className="rounded-md border border-line px-3 py-2 text-sm hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Replace “{currentName}”
              </button>
              {dirty && (
                <button
                  onClick={saveDraft}
                  className="rounded-md border border-line px-3 py-2 text-sm hover:bg-surface2"
                >
                  {isMine ? 'Save changes' : 'Save to My profiles'}
                </button>
              )}
              {isMine && (
                <button
                  onClick={() => remove(picked)}
                  className="ml-auto rounded-md border border-line px-3 py-2 text-sm text-danger hover:bg-surface2"
                >
                  Delete
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function Tiles({
  title,
  items,
  picked,
  onPick,
  empty
}: {
  title: string
  items: Preset[]
  picked: Preset
  onPick: (p: Preset) => void
  empty?: string
}): React.JSX.Element {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {items.length === 0 && empty ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {items.map((p) => {
            const chip = chipsFor(p.profile.match.windows)[0]
            return (
              <li key={p.id}>
                <button
                  onClick={() => onPick(p)}
                  aria-pressed={picked.id === p.id}
                  title={p.note}
                  className={`flex h-20 w-full flex-col items-center justify-center gap-1.5 rounded-lg px-1 ${picked.id === p.id ? 'bg-selected outline outline-2 outline-accent' : 'hover:bg-surface2'}`}
                >
                  <ProgramIcon
                    proc={chip?.procs[0] ?? p.name.toLowerCase()}
                    program={chip?.program}
                    size={30}
                  />
                  <span className="w-full truncate text-center text-xs">{p.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
