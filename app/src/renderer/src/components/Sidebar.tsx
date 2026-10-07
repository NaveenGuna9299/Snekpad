import { MAX_PROFILES, type Profile } from '../../../shared/config'
import { chipsFor } from '../lib/programs'
import { ProgramIcon } from './ProgramIcon'

type Props = {
  profiles: Profile[]
  selected: number
  onSelect: (i: number) => void
  onAdd: () => void
  onDuplicate: () => void
  onDelete: () => void
  onRename: (name: string) => void
  onMore: () => void
  /** Index of the profile the pad is running, once the pad reports it. */
  activeOnPad?: number
}

export function Sidebar({
  profiles,
  selected,
  onSelect,
  onAdd,
  onDuplicate,
  onDelete,
  onRename,
  onMore,
  activeOnPad
}: Props): React.JSX.Element {
  const full = profiles.length >= MAX_PROFILES
  const current = profiles[selected]
  const isGeneral = current.id === 'general'
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-3 border-r border-line bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Profiles</h2>
        <span className="text-xs text-muted" title="The pad holds at most 4 profiles">
          {profiles.length}/{MAX_PROFILES}
        </span>
      </div>

      <ul className="flex flex-col gap-1">
        {profiles.map((p, i) => (
          <li key={p.id}>
            <button
              onClick={() => onSelect(i)}
              aria-current={i === selected}
              className={`w-full rounded-md px-3 py-2 text-left ${i === selected ? 'bg-selected text-fg' : 'hover:bg-surface2'}`}
            >
              <span className="flex items-center justify-between font-medium">
                {p.name}
                {i === activeOnPad && (
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
                ) : p.match.windows.length === 0 ? (
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
                  </>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <SmallButton
          onClick={onAdd}
          disabled={full}
          title={full ? 'The pad holds at most 4 profiles' : 'New profile'}
        >
          New
        </SmallButton>
        <SmallButton
          onClick={onDuplicate}
          disabled={full}
          title={full ? 'The pad holds at most 4 profiles' : 'Duplicate'}
        >
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
