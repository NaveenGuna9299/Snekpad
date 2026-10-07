import { useEffect, useRef } from 'react'

export type Shortcuts = {
  undo: () => void
  redo: () => void
  push: () => void
  /** Arrow key on the pad: move the selected key by this many columns / rows. */
  move: (dCol: number, dRow: number) => void
  /** Alt+Arrow: swap the selected key with its neighbour. */
  swap: (dCol: number, dRow: number) => void
  copy: () => void
  paste: () => void
}

const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && t.matches('input, textarea, select, [contenteditable]')

/**
 * Editor shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo, Ctrl/Cmd+Enter push, arrows move
 * between keys, Alt+arrows swap a key with its neighbour, Ctrl/Cmd+C / V copy and paste a key. Text fields keep their own undo, and a key recorder that already handled the event wins.
 */
export function useShortcuts(handlers: Shortcuts, enabled: boolean): void {
  const ref = useRef(handlers)
  useEffect(() => {
    ref.current = handlers
  })
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || typing(e.target)) return
      const h = ref.current
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (mod && k === 'z') {
        e.preventDefault()
        if (e.shiftKey) h.redo()
        else h.undo()
      } else if (mod && k === 'y') {
        e.preventDefault()
        h.redo()
      } else if (mod && e.key === 'Enter') {
        e.preventDefault()
        h.push()
      } else if (mod && k === 'c') {
        h.copy()
      } else if (mod && k === 'v') {
        h.paste()
      } else if (!mod && e.key.startsWith('Arrow')) {
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
          e.key
        ]
        if (d) {
          e.preventDefault()
          if (e.altKey) h.swap(d[0], d[1])
          else h.move(d[0], d[1])
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
