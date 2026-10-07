import { COLS, KEY_COUNT } from '../../../shared/config'

/** The key one step away on the 4 x 3 grid (no wrapping), or null at the edge. */
export function neighbor(index: number, dCol: number, dRow: number): number | null {
  const col = (index % COLS) + dCol
  const row = Math.floor(index / COLS) + dRow
  if (col < 0 || col >= COLS || row < 0) return null
  const next = row * COLS + col
  return next < KEY_COUNT ? next : null
}
