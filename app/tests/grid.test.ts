import { describe, expect, it } from 'vitest'
import { neighbor } from '../src/renderer/src/lib/grid'

describe('neighbor', () => {
  it('moves one step on the 4 x 3 grid', () => {
    expect(neighbor(0, 1, 0)).toBe(1)
    expect(neighbor(0, 0, 1)).toBe(4)
    expect(neighbor(5, -1, -1)).toBe(0)
  })

  it('stops at the edges instead of wrapping', () => {
    expect(neighbor(0, -1, 0)).toBeNull()
    expect(neighbor(3, 1, 0)).toBeNull() // right edge must not wrap to the next row
    expect(neighbor(0, 0, -1)).toBeNull()
    expect(neighbor(8, 0, 1)).toBeNull()
  })
})
