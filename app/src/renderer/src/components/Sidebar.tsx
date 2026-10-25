import {
  MAX_ALL_PROFILES,
  MAX_PROFILES,
  MAX_STUDIO_PROFILES,
  type Profile
} from '../../../shared/config'
import { chipsFor } from '../lib/programs'
import { ProgramIcon } from './ProgramIcon'

type Props = {
  /** The pad's own profiles (General first). */
  profiles: Profile[]
  /** The profiles only Studio keeps: the pad gets one when its app is in focus. */
  studioProfiles: Profile[]
  /** Index into the two lists one after the other (the pad's first). */
  selected: number
  onSelect: (i: number) => void
  onAdd: () => void
  onDuplicate: () => void
  onDelete: () => void
  /** Move the selected profile between "on the pad" and "Studio only". */
  onMove: () => void
  onRename: (name: string) => void
  onMore: () => void
  /** Save the selected profile to a file / add a profile from a file. */
  onExport: () => void
  onImport: () => void
  /** Index of the pad's own profile the pad is running, once the pad reports it. */
  activeOnPad?: number
  /** The id of the Studio profile the pad is running, once it is on the pad's slot and in use. */
  activeStudio?: string
  /** The connected pad can take Studio profiles (firmware with the slot). */
  slotSupported: boolean
  /** The pad refused a Studio profile: the one that was refused and why ('too big' = not enough RAM for its macros). */
  slotError?: { id: string; reason: string }
}

export function Sidebar({
  profiles,
  studioProfiles,
  selected,
  onSelect,
  onAdd,
  onDuplicate,
  onDelete,
  onMove,
  onRename,
  onMore,
  onExport,
  onImport,
  activeOnPad,
  activeStudio,
  slotSupported,
  slotError
}: Props): React.JSX.Element {
  const all = [...profiles, ...studioProfiles]
  const full = all.length >= MAX_ALL_PROFILES
  const current = all[selected]
  const isGeneral = current.id === 'general'
  const onPad = selected < profiles.length
  const moveBlocked =
    isGeneral ||
    (onPad ? studioProfiles.length >= MAX_STUDIO_PROFILES : profiles.length >= MAX_PROFILES)
  const fullTip = `Studio holds at most ${MAX_ALL_PROFILES} profiles: ${MAX_PROFILES} on the pad and ${MAX_STUDIO_PROFILES} more here`
  const moveTip = isGeneral
    ? 'General always stays on the pad'
    : onPad
      ? studioProfiles.length >= MAX_STUDIO_PROFILES
        ? 'Studio-only profiles are full'
        : 'Keep this profile in Studio only: the pad gets it when its app is in focus'
      : profiles.length >= MAX_PROFILES
        ? `The pad holds at most ${MAX_PROFILES} profiles`
        : 'Keep this profile on the pad, so it works without Studio'

  const row = (p: Profile, i: number, active: boolean): React.JSX.Element => (
    <li key={p.id}>
      <button
        onClick={() => onSelect(i)}
        aria-current={i === selected}
        className={`w-full rounded-md px-3 py-2 text-left ${i === selected ? 'bg-selected text-fg' : 'hover:bg-surface2'}`}
      >
        <span className="flex items-center justify-between font-medium">
          {p.name}
          {active && (
            <span
              className="flex items-center gap-1 text-xs font-normal text-ok"
              title="The pad is running this profile"
            >
              <span className="h-2 w-2 rounded-full bg-ok" />
              On pad
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
          {p.id === 'general' ? (
            'Fallback for every other app'
          ) : p.match.windows.length === 0 && p.match.titles.length === 0 ? (
            'No app set'
          ) : (
            <>
              {chipsFor(p.match.windows)
                .slice(0, 5)
                .map((c) => (
                  <ProgramIcon key={c.key} proc={c.procs[0]} program={c.program} size={16} />
                ))}
              {chipsFor(p.match.windows).length > 5 && (
                <span>+{chipsFor(p.match.windows).length - 5}</span>
              )}
              {p.match.titles.length > 0 && (
                <span className="truncate" title="Window title contains">
                  {p.match.windows.length > 0 ? '+ ' : ''}“{p.match.titles.join('”, “')}”
                </span>
              )}
            </>
          )}
        </span>
        {slotError?.id === p.id && (
          <span className="mt-1 block text-xs text-danger" role="alert">
            {slotError.reason === 'too big'
              ? 'Too big for the pad: use fewer or shorter macros.'
              : `The pad refused it: ${slotError.reason}`}
          </span>
        )}
      </button>
    </li>
  )

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">On the pad</h2>
        <span
          className="text-xs text-muted"
          title="The pad keeps these itself, so they work without Studio"
        >
          {profiles.length}/{MAX_PROFILES}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {profiles.map((p, i) => row(p, i, i === activeOnPad))}
      </ul>

      <div className="mt-1 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Studio only</h2>
        <span
          className="text-xs text-muted"
          title="Studio keeps these and puts one on the pad when its app is in focus"
        >
          {studioProfiles.length}/{MAX_STUDIO_PROFILES}
        </span>
      </div>
      {studioProfiles.length === 0 ? (
        <p className="text-xs text-muted">
          More profiles for more apps. The pad gets one when its app is in focus.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {studioProfiles.map((p, i) => row(p, profiles.length + i, p.id === activeStudio))}
        </ul>
      )}
      {studioProfiles.length > 0 && !slotSupported && (
        <p className="text-xs text-muted" role="note">
          This pad&apos;s firmware cannot take them yet. Update the pad from Home.
        </p>
      )}

      <div className="flex gap-2">
        <SmallButton onClick={onAdd} disabled={full} title={full ? fullTip : 'New profile'}>
          New
        </SmallButton>
        <SmallButton onClick={onDuplicate} disabled={full} title={full ? fullTip : 'Duplicate'}>
          Copy
        </SmallButton>
        <SmallButton
          onClick={onDelete}
          disabled={isGeneral}
          title={isGeneral ? 'General cannot be deleted' : 'Delete profile'}
        >
          Delete
        </SmallButton>
      </div>
      <div className="flex">
        <SmallButton onClick={onMove} disabled={moveBlocked} title={moveTip}>
          {onPad ? 'Move to Studio only' : 'Move to the pad'}
        </SmallButton>
      </div>
      {moveBlocked && !isGeneral && <p className="text-xs text-muted">{moveTip}.</p>}

      <label className="mt-2 flex flex-col gap-1 text-xs text-muted">
        Profile name
        <input
          value={current.name}
          maxLength={12}
          disabled={isGeneral}
          onChange={(e) => onRename(e.target.value)}
          className="rounded-md border border-line bg-input px-2 py-1.5 text-sm text-fg disabled:opacity-60"
        />
      </label>

      <button
        onClick={onMore}
        className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface2"
      >
        More profiles…
      </button>
      <div className="flex gap-2">
        <SmallButton onClick={onExport} title="Save this profile to a file, to share it or keep it">
          Export…
        </SmallButton>
        <SmallButton
          onClick={onImport}
          disabled={full}
          title={full ? fullTip : 'Add a profile from a file'}
        >
          Import…
        </SmallButton>
      </div>
    </aside>
  )
}

function SmallButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button
      {...rest}
      className="flex-1 rounded-md border border-line px-2 py-1.5 text-xs hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}
