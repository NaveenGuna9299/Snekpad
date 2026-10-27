import { describe, expect, it } from 'vitest'
import {
  blankProfile,
  defaultConfig,
  FN_KEY,
  validateConfig,
  type Action,
  type Config,
  type Profile
} from '../src/shared/config'
import { describeAction } from '../src/renderer/src/lib/describe'

const withProfile = (fn: (p: Profile) => Profile): Config => {
  const c = defaultConfig()
  return { ...c, profiles: [fn(c.profiles[0]), ...c.profiles.slice(1)] }
}
const withKey0 = (action: Action, layers = 1) =>
  withProfile((p) => ({
    ...p,
    keys: p.keys.map((k, i) => (i === 0 ? { ...k, action } : k)),
    layers: Array.from({ length: layers }, () => ({ keys: blankProfile('x', 'x').keys }))
  }))

const errors = (c: unknown): string[] => {
  const r = validateConfig(c)
  return r.ok ? [] : r.errors
}

describe('extra layers', () => {
  it('a config saved before layers existed still loads, with no layers', () => {
    const old = JSON.parse(JSON.stringify(defaultConfig()))
    for (const p of [...old.profiles, ...old.studioProfiles]) delete p.layers
    const r = validateConfig(old)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.config.profiles[0].layers).toEqual([])
  })

  it('accepts a layer key that points at a layer the profile has', () => {
    expect(errors(withKey0({ type: 'layer', mode: 'hold', layer: 1 }))).toEqual([])
    expect(errors(withKey0({ type: 'layer', mode: 'toggle', layer: 1 }))).toEqual([])
  })

  it('refuses a layer key when the profile has no layer', () => {
    expect(errors(withKey0({ type: 'layer', mode: 'hold', layer: 1 }, 0)).join()).toMatch(
      /no layer 1/
    )
  })

  it('refuses a second layer (the pad has room for one)', () => {
    expect(errors(withKey0({ type: 'none' }, 2)).length).toBeGreaterThan(0)
  })

  it('keeps the FN key on the extra layer too', () => {
    const c = withKey0({ type: 'none' })
    c.profiles[0].layers[0].keys[FN_KEY] = { label: '', color: '#303030', action: { type: 'none' } }
    expect(errors(c).join()).toMatch(/FN key/)
  })

  it('refuses a layer key on the knob', () => {
    const c = withKey0({ type: 'none' })
    c.profiles[0].encoder.press = { type: 'layer', mode: 'hold', layer: 1 }
    expect(errors(c).join()).toMatch(/knob/)
  })
})

describe('tap / hold / double tap', () => {
  const tap = { type: 'key', key: 'A' } as const

  it('accepts a hold, a double tap, or both', () => {
    for (const a of [
      { type: 'tap_hold', tap, hold: { type: 'key', key: 'B' } },
      { type: 'tap_hold', tap, double: { type: 'key', key: 'C' } },
      {
        type: 'tap_hold',
        tap,
        hold: { type: 'key', key: 'B' },
        double: { type: 'key', key: 'C' },
        ms: 400
      },
      { type: 'tap_hold', tap, hold: { type: 'layer', mode: 'hold', layer: 1 } }
    ] as Action[])
      expect(errors(withKey0(a)), JSON.stringify(a)).toEqual([])
  })

  it('needs a hold or a double tap', () => {
    expect(errors(withKey0({ type: 'tap_hold', tap })).join()).toMatch(/hold or a double/)
  })

  it('limits the time like the pad does', () => {
    for (const ms of [99, 1001, 2.5])
      expect(
        errors(withKey0({ type: 'tap_hold', tap, hold: tap, ms } as Action)).length,
        String(ms)
      ).toBeGreaterThan(0)
  })

  it('does not nest, and cannot use FN inside', () => {
    expect(
      errors(withKey0({ type: 'tap_hold', tap: { type: 'fn' }, hold: tap } as unknown as Action))
        .length
    ).toBeGreaterThan(0)
    expect(
      errors(
        withKey0({
          type: 'tap_hold',
          tap: { type: 'tap_hold', tap, hold: tap },
          hold: tap
        } as unknown as Action)
      ).length
    ).toBeGreaterThan(0)
  })

  it('refuses a tap/hold key on the knob', () => {
    const c = withKey0({ type: 'none' })
    c.profiles[0].encoder.cw = { type: 'tap_hold', tap, hold: tap }
    expect(errors(c).join()).toMatch(/knob/)
  })
})

describe('describing the new actions', () => {
  it('says what a layer key does', () => {
    expect(describeAction({ type: 'layer', mode: 'hold', layer: 1 })).toBe('Hold for layer 2')
    expect(describeAction({ type: 'layer', mode: 'toggle', layer: 1 })).toBe('Toggle layer 2')
  })

  it('lists tap, hold and double tap', () => {
    expect(
      describeAction({
        type: 'tap_hold',
        tap: { type: 'key', key: 'A' },
        hold: { type: 'key', key: 'B' },
        double: { type: 'key', key: 'C' }
      })
    ).toBe('Tap: A · Hold: B · Double: C')
  })
})
