import { useEffect, useState } from 'react'
import { iconCache } from '../lib/iconCache'
import { programForProc, visibleColor, type Program } from '../lib/programs'

function useSavedIcon(proc: string, skip: boolean): string | null {
  const [icon, setIcon] = useState<string | null>(iconCache.get(proc) ?? null)
  useEffect(() => {
    if (skip || iconCache.has(proc)) return
    window.api.programIcon(proc).then((i) => {
      iconCache.set(proc, i)
      setIcon(i)
    })
  }, [proc, skip])
  return icon
}

type Props = {
  proc: string // process name (used to look up the program and any saved icon)
  program?: Program
  icon?: string | null // an icon we already have (for example from the running list)
  size?: number
}

/** The program's logo, else its own icon from this computer, else a coloured letter tile. */
export function ProgramIcon({ proc, program, icon, size = 22 }: Props): React.JSX.Element {
  const p = program ?? programForProc(proc)
  const saved = useSavedIcon(proc, !!p?.icon || !!icon)
  const radius = Math.round(size * 0.22)

  if (p?.icon) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={p.name} className="shrink-0">
        <path d={p.icon.path} fill={visibleColor(p.icon.hex)} />
      </svg>
    )
  }
  const src = icon ?? saved
  if (src) {
    return <img src={src} width={size} height={size} alt={p?.name ?? proc} className="shrink-0" style={{ borderRadius: radius }} />
  }
  const label = (p?.name ?? proc).trim()
  return (
    <span
      aria-label={label}
      className="inline-flex shrink-0 items-center justify-center font-semibold text-white"
      style={{ width: size, height: size, borderRadius: radius, background: p?.color ?? '#5865f2', fontSize: size * 0.5 }}
    >
      {label.charAt(0).toUpperCase()}
    </span>
  )
}
