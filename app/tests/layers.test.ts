import { describe, expect, it } from 'vitest'
import {
  blankProfile,
  defaultConfig,
  FN_KEY,
  forPad,
  migrateConfig,
  resolveProfileForOs,
  validateConfig,
  withoutStudioOnly,
  type Action,
  type Config,
  type Profile
} from '../src/shared/config'
import { describeAction } from '../src/renderer/src/lib/describe'
import { slotFrames } from '../src/shared/protocol'
import { hasLayers, lacksLayers } from '../src/shared/firmware'
import { profileCost } from '../src/shared/slotCost'

// Layers, layer keys and double tap are for Studio-only profiles: the pad builds its own profiles at start-up, where the
// screen needs the RAM. A tap/hold key with a plain hold is cheap and fine anywhere.

const tap = { type: 'key', key: 'A' } as const
const hold = { type: 'key', key: 'B' } as const
const layerHold = { type: 'layer', mode: 'hold', layer: 1 } as const

const errors = (c: unknown): string[] => {
  const r = validateConfig(c)
  return r.ok ? [] : r.errors
}

/** The default config with `edit` applied to its first Studio-only profile (Browser). */
const studio = (edit: (p: Profile) => Profile): Config => {
  const c = defaultConfig()
  return { ...c, studioProfiles: [edit(c.studioProfiles[0]), ...c.studioProfiles.slice(1)] }
}
/** The default config with `edit` applied to the pad's General profile. */
const onPad = (edit: (p: Profile) => Profile): Config => {
  const c = defaultConfig()
  return { ...c, profiles: [edit(c.profiles[0]), ...c.profiles.slice(1)] }
}
const withKey0 = (p: Profile, action: Action): Profile => ({
  ...p,
  keys: p.keys.map((k, i) => (i === 0 ? { ...k, action } : k))
})
const withLayers = (p: Profile, n: number): Profile => ({
  ...p,
  layers: Array.from({ length: n }, () => ({ keys: blankProfile('x', 'x').keys }))
})

describe('layers in a Studio-only profile', () => {
  it('a config saved before layers existed still loads, with no layers', () => {
    const old = JSON.parse(JSON.stringify(defaultConfig()))
    for (const p of [...old.profiles, ...old.studioProfiles]) delete p.layers
    const r = validateConfig(old)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.config.studioProfiles[0].layers).toEqual([])
  })

  it('takes one or two layers and a layer key for each', () => {
    for (const n of [1, 2]) {
      const c = studio((p) => withKey0(withLayers(p, n), { ...layerHold, layer: n }))
      expect(errors(c)).toEqual([])
    }
  })

  it('refuses a third layer', () => {
    expect(errors(studio((p) => withLayers(p, 3))).length).toBeGreaterThan(0)
  })

  it('refuses a layer key for a layer the profile does not have', () => {
    expect(errors(studio((p) => withKey0(p, layerHold))).join()).toMatch(/no layer 1/)
    expect(
      errors(studio((p) => withKey0(withLayers(p, 1), { ...layerHold, layer: 2 }))).join()
    ).toMatch(/no layer 2/)
  })

  it('keeps the FN key on every layer', () => {
    const c = studio((p) => withLayers(p, 2))
    c.studioProfiles[0].layers[1].keys[FN_KEY] = {
      label: '',
      color: '#303030',
      action: { type: 'none' }
    }
    expect(errors(c).join()).toMatch(/FN key/)
  })

  it('refuses a layer key or a tap/hold key on the knob', () => {
    const a = studio((p) => withLayers(p, 1))
    a.studioProfiles[0].encoder.press = layerHold
    expect(errors(a).join()).toMatch(/knob/)
    const b = studio((p) => p)
    b.studioProfiles[0].encoder.cw = { type: 'tap_hold', tap, hold }
    expect(errors(b).join()).toMatch(/knob/)
  })

  it('allows a double tap and a hold that is a layer key', () => {
    for (const a of [
      { type: 'tap_hold', tap, double: hold },
      { type: 'tap_hold', tap, hold: layerHold },
      { type: 'tap_hold', tap, hold, double: hold, ms: 400 }
    ] as Action[])
      expect(errors(studio((p) => withKey0(withLayers(p, 1), a))), JSON.stringify(a)).toEqual([])
  })
})

describe("the pad's own profiles", () => {
  it('have no layers, no layer keys and no double tap', () => {
    expect(errors(onPad((p) => withLayers(p, 1))).join()).toMatch(/Studio-only/)
    expect(errors(onPad((p) => withKey0(p, layerHold))).join()).toMatch(/Studio-only/)
    expect(
      errors(onPad((p) => withKey0(p, { type: 'tap_hold', tap, double: hold }))).join()
    ).toMatch(/Studio-only/)
    expect(
      errors(onPad((p) => withKey0(p, { type: 'tap_hold', tap, hold: layerHold }))).join()
    ).toMatch(/Studio-only/)
  })

  it('may use tap and hold with a plain key', () => {
    expect(errors(onPad((p) => withKey0(p, { type: 'tap_hold', tap, hold, ms: 300 })))).toEqual([])
  })

  it('lose what is not allowed when a file from an early build is loaded', () => {
    const raw = JSON.parse(
      JSON.stringify(
        onPad((p) =>
          withKey0(withLayers(p, 1), { type: 'tap_hold', tap, hold: layerHold, double: hold })
        )
      )
    )
    raw.profiles[0].keys[1].action = layerHold
    const r = validateConfig(migrateConfig(raw))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.config.profiles[0].layers).toEqual([])
      expect(r.config.profiles[0].keys[0].action).toEqual(tap)
      expect(r.config.profiles[0].keys[1].action).toEqual({ type: 'none' })
    }
  })

  it('forPad takes layers, layer keys and double tap out and keeps a plain hold', () => {
    const p = withKey0(withLayers(blankProfile('a', 'a'), 2), {
      type: 'tap_hold',
      tap,
      hold,
      double: hold
    })
    const out = forPad(p)
    expect(out.layers).toEqual([])
    expect(out.keys[0].action).toEqual({ type: 'tap_hold', tap, hold })
    expect(withoutStudioOnly(layerHold)).toEqual({ type: 'none' })
    expect(withoutStudioOnly({ type: 'tap_hold', tap, hold: layerHold })).toEqual(tap)
  })
})

describe('sending a layered profile to the pad', () => {
  const layered = (): Profile => {
    const p = withLayers(blankProfile('a', 'a'), 2)
    p.keys[0].action = { type: 'tap_hold', tap, hold: layerHold }
    p.layers[0].keys[0] = { label: 'one', color: '#112233', action: { type: 'key', key: 'N1' } }
    p.layers[1].keys[0] = {
      label: 'two',
      color: '#445566',
      action: { type: 'sequence', steps: [{ keys: ['CTRL', 'C'], wait: 0 }] }
    }
    return p
  }

  it('says how many layers and sends their keys after the knob, 12 for each', () => {
    const lines = slotFrames(layered())
    expect(lines[0]).toBe('SLOT_BEGIN\ta\tKNOB:VOL\t2')
    const keyNumbers = lines
      .filter((l) => l.startsWith('SLOT_KEY'))
      .map((l) => Number(l.split('\t')[1]))
    expect(keyNumbers).toEqual(Array.from({ length: 39 }, (_, i) => i))
    expect(lines.find((l) => l.startsWith('SLOT_KEY\t15\t'))).toContain('one')
    expect(lines.find((l) => l.startsWith('SLOT_KEY\t27\t'))).toContain('{"type":"sequence"}')
    expect(lines.find((l) => l.startsWith('SLOT_STEP\t27\t'))).toBe('SLOT_STEP\t27\tCTRL+C\t0')
    expect(lines.at(-1)).toBe('SLOT_END')
  })

  it('is the old wire format when there are no layers', () => {
    expect(slotFrames(blankProfile('a', 'a'))[0]).toBe('SLOT_BEGIN\ta\tKNOB:VOL')
    expect(slotFrames(blankProfile('a', 'a'))).toHaveLength(1 + 15 + 1)
  })

  it('swaps CTRL for Cmd inside tap/hold keys and on the layers on a Mac', () => {
    const p = layered()
    p.keys[0].action = {
      type: 'tap_hold',
      tap: { type: 'hotkey', keys: ['CTRL', 'S'], cmdOnMac: true },
      hold: layerHold
    }
    p.layers[0].keys[0].action = { type: 'hotkey', keys: ['CTRL', 'Z'], cmdOnMac: true }
    const mac = resolveProfileForOs(p, 'macos')
    expect(mac.keys[0].action).toMatchObject({ tap: { keys: ['GUI', 'S'] } })
    expect(mac.layers[0].keys[0].action).toMatchObject({ keys: ['GUI', 'Z'] })
  })

  it('is warned about on a pad with older firmware', () => {
    const dev = (firmware: string) =>
      ({ status: 'connected', firmware }) as unknown as Parameters<typeof hasLayers>[0]
    expect(hasLayers(dev('0.5.1'))).toBe(false)
    expect(hasLayers(dev('0.6.0'))).toBe(true)
    expect(lacksLayers(dev('0.5.1'))).toBe(true)
    expect(lacksLayers(dev('0.6.0'))).toBe(false)
  })

  it('does not warn while the pad has not said its firmware yet (right after a push it restarts)', () => {
    const connected = { status: 'connected' } as unknown as Parameters<typeof lacksLayers>[0]
    expect(lacksLayers(connected)).toBe(false) // connected, no HELLO answer yet
    expect(lacksLayers({ ...connected, events: true })).toBe(true) // answered HELLO with no version: old firmware
    expect(lacksLayers({ ...connected, legacy: true })).toBe(true) // never answered HELLO: old firmware
    expect(lacksLayers({ status: 'disconnected' } as never)).toBe(false)
  })
})

describe('what a layered profile costs on the pad', () => {
  const plain = blankProfile('a', 'a')

  it('counts each layer, and the module for layer keys once', () => {
    const one = profileCost(withLayers(plain, 1)) - profileCost(plain)
    const two = profileCost(withLayers(plain, 2)) - profileCost(plain)
    expect(one).toBeGreaterThan(1500) // the first layer also brings in key_extras.py (measured: 1872)
    expect(two - one).toBe(740) // each further layer (measured: 736)
  })

  it('counts the double-tap module once, however many keys use it', () => {
    const k = (i: number): Action => ({ type: 'tap_hold', tap, double: hold, ms: 200 + i })
    const a = withKey0(plain, k(0))
    const b = { ...a, keys: a.keys.map((x, i) => (i < 3 ? { ...x, action: k(i) } : x)) }
    const base = profileCost(plain)
    expect(profileCost(a) - base).toBeGreaterThan(1500)
    // two more keys add only their own few bytes, not another module
    expect(profileCost(b) - profileCost(a)).toBeLessThan(500)
  })
})

describe('describing the new actions', () => {
  it('says what a layer key does', () => {
    expect(describeAction({ type: 'layer', mode: 'hold', layer: 1 })).toBe('Hold for layer 2')
    expect(describeAction({ type: 'layer', mode: 'toggle', layer: 2 })).toBe('Toggle layer 3')
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
