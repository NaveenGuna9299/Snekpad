import { useCallback, useState } from 'react'

/** State with undo / redo. `set` records a new step; `replace` swaps the value without history. */
export function useHistory<T>(initial: T | null) {
  const [state, setState] = useState<{ past: T[]; present: T | null; future: T[] }>({
    past: [],
    present: initial,
    future: []
  })

  const set = useCallback((next: T) => {
    setState((s) => ({ past: s.present ? [...s.past, s.present].slice(-100) : s.past, present: next, future: [] }))
  }, [])

  const replace = useCallback((next: T) => setState({ past: [], present: next, future: [] }), [])

  const undo = useCallback(() => {
    setState((s) => {
      if (!s.past.length || !s.present) return s
      return { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] }
    })
  }, [])

  const redo = useCallback(() => {
    setState((s) => {
      if (!s.future.length || !s.present) return s
      return { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) }
    })
  }, [])

  return { value: state.present, set, replace, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 }
}
