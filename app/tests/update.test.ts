import { describe, expect, it } from 'vitest'
import { isNewer } from '../src/shared/update'

describe('isNewer', () => {
  it('compares x.y.z numerically', () => {
    expect(isNewer('0.1.1', '0.1.0')).toBe(true)
    expect(isNewer('0.10.0', '0.9.0')).toBe(true)
    expect(isNewer('1.0.0', '0.9.9')).toBe(true)
  })

  it('is false for the same or an older version', () => {
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('0.1.0', '0.2.0')).toBe(false)
  })

  it('ignores a leading v and a suffix', () => {
    expect(isNewer('v0.2.0', '0.1.0')).toBe(true)
    expect(isNewer('0.1.0-beta', '0.1.0')).toBe(false)
  })
})
