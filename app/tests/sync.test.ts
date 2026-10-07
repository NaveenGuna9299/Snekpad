import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../src/shared/config'
import { canAdoptLiveView, syncStatus } from '../src/shared/sync'

const edited = (): ReturnType<typeof defaultConfig> => {
  const c = defaultConfig()
  c.profiles[0].keys[0].label = 'EDIT'
  return c
}

describe('sync state', () => {
  it('reports each state', () => {
    const c = defaultConfig()
    expect(syncStatus(false, false, c, c)).toBe('no-pad')
    expect(syncStatus(true, true, c, c)).toBe('sending')
    expect(syncStatus(true, false, c, defaultConfig())).toBe('in-sync')
    expect(syncStatus(true, false, edited(), c)).toBe('unsent')
    expect(syncStatus(true, false, c, null)).toBe('unsent')
  })

  it('never lets the pad overwrite unsent edits', () => {
    expect(canAdoptLiveView(edited(), defaultConfig())).toBe(false)
  })

  it('adopts the pad view when nothing would be lost', () => {
    expect(canAdoptLiveView(defaultConfig(), defaultConfig())).toBe(true)
    expect(canAdoptLiveView(edited(), null)).toBe(true) // no record of the pad yet
  })
})
