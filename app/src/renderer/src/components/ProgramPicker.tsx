import { useCallback, useState } from 'react'
import type { RunningProgram } from '../../../shared/api'
import { PROGRAMS, programForProc, chipsFor } from '../lib/programs'
import { ProgramIcon } from './ProgramIcon'
import { forgetIcon } from '../lib/iconCache'

type Props = {
  windows: string[] // process names already in the profile
  macos: string[]
  onChange: (windows: string[], macos: string[]) => void
}

/** Chips with icons for the programs that switch to this profile, plus a picker to add more. */
export function ProgramPicker({ windows, macos, onChange }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState<RunningProgram[] | null>(null)
  const [custom, setCustom] = useState('')
  const chips = chipsFor(windows)

  const loadRunning = useCallback(() => {
    setRunning(null)
    void window.api.runningPrograms().then(setRunning)
  }, [])

  const toggle = (): void => {
    if (!open) loadRunning()
    setOpen(!open)
  }

  const addProcs = (procs: string[], macIds: string[] = []): void => {
    onChange([...new Set([...windows, ...procs])], [...new Set([...macos, ...macIds])])
    for (const p of procs) {
      void window.api.rememberProgram(p).then(() => forgetIcon(p))
    }
  }

  const remove = (procs: string[]): void => {
    const program = programForProc(procs[0])
    onChange(
      windows.filter((w) => !procs.includes(w)),
      program ? macos.filter((m) => !program.macos.includes(m)) : macos
    )
  }

  const addProgram = (proc: string): void => {
    const program = programForProc(proc)
    addProcs(program ? program.windows : [proc], program?.macos)
  }

  const inProfile = (proc: string): boolean => windows.includes(proc)

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-1.5" aria-label="Programs">
        {chips.length === 0 && <li className="text-sm text-muted">No program set yet.</li>}
        {chips.map((c) => (
          <li key={c.key} className="flex items-center gap-1.5 rounded-md border border-line bg-input py-1 pl-1.5 pr-1 text-sm">
            <ProgramIcon proc={c.procs[0]} program={c.program} size={20} />
            <span>{c.name}</span>
            <button onClick={() => remove(c.procs)} aria-label={`Remove ${c.name}`} className="rounded px-1 text-muted hover:bg-surface2 hover:text-danger">
              ✕
            </button>
          </li>
        ))}
      </ul>

      <button onClick={toggle} aria-expanded={open} className="self-start rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface2">
        {open ? 'Close' : '+ Add program'}
      </button>

      {open && (
        <div className="flex flex-col gap-3 rounded-md border border-line bg-surface2 p-3">
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Open now</h4>
              <button onClick={loadRunning} className="text-xs text-muted hover:text-fg">Refresh</button>
            </div>
            {running === null ? (
              <p className="text-sm text-muted">Looking…</p>
            ) : running.length === 0 ? (
              <p className="text-sm text-muted">No open programs found (this list needs Windows).</p>
            ) : (
              <ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto">
                {running.map((r) => (
                  <li key={r.proc}>
                    <button
                      disabled={inProfile(r.proc)}
                      onClick={() => addProgram(r.proc)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-selected disabled:opacity-40"
                    >
                      <ProgramIcon proc={r.proc} icon={r.icon} size={22} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{programForProc(r.proc)?.name ?? r.proc}</span>
                        <span className="block truncate text-xs text-muted">{r.title}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Popular</h4>
            <ul className="grid grid-cols-5 gap-1">
              {PROGRAMS.map((p) => {
                const used = p.windows.some(inProfile)
                return (
                  <li key={p.id}>
                    <button
                      disabled={used}
                      onClick={() => addProcs(p.windows, p.macos)}
                      title={p.name}
                      aria-label={`Add ${p.name}`}
                      className="flex h-10 w-full items-center justify-center rounded hover:bg-selected disabled:opacity-30"
                    >
                      <ProgramIcon proc={p.windows[0]} program={p} size={24} />
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const proc = custom.trim().toLowerCase().replace(/\.exe$/, '')
              if (proc) addProgram(proc)
              setCustom('')
            }}
          >
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Other program, e.g. notepad"
              aria-label="Program name"
              className="min-w-0 flex-1 rounded-md border border-line bg-input px-2 py-1.5 text-sm text-fg"
            />
            <button type="submit" className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface">Add</button>
          </form>
        </div>
      )}
    </div>
  )
}
