import { describe, expect, it } from 'vitest'
import {
  type Action,
  blankProfile,
  DEFAULT_EFFECT,
  DEFAULT_SLEEP_MINUTES,
  defaultConfig,
  EFFECTS,
  isMusicEffect,
  MAX_PROFILES,
  MAX_SLEEP_MINUTES,
  migrateConfig,
  resolveForOs,
  validateConfig
} from '../src/shared/config'

describe('config validation', () => {
  it('accepts the starter config', () => {
    expect(validateConfig(defaultConfig()).ok).toBe(true)
  })

  it('rejects a fifth profile', () => {
    const c = defaultConfig()
    c.profiles.push(blankProfile('extra', 'Extra'))
    expect(c.profiles.length).toBe(MAX_PROFILES + 1)
    expect(validateConfig(c).ok).toBe(false)
  })

  it('rejects labels longer than the OLED cell', () => {
    const c = defaultConfig()
    c.profiles[0].keys[0].label = 'toolong'
    expect(validateConfig(c).ok).toBe(false)
  })

  it('requires General first and the FN key in place', () => {
    const c = defaultConfig()
    c.profiles[0].id = 'other'
    expect(validateConfig(c).ok).toBe(false)
    const d = defaultConfig()
    d.profiles[1].keys[11].action = { type: 'none' }
    expect(validateConfig(d).ok).toBe(false)
  })

  it('rejects duplicate profile ids and bad colours', () => {
    const c = defaultConfig()
    c.profiles[1].id = 'general'
    expect(validateConfig(c).ok).toBe(false)
    const d = defaultConfig()
    d.profiles[0].keys[0].color = 'red'
    expect(validateConfig(d).ok).toBe(false)
  })

  it('keeps the compact config small enough for the pad', () => {
    expect(JSON.stringify(defaultConfig()).length).toBeLessThan(8000)
  })
})

describe('multi-key actions', () => {
  const seq = (n: number, wait = 100): Action => ({
    type: 'sequence' as const,
    steps: Array.from({ length: n }, (_, i) => ({ keys: i === 0 ? ['CTRL', 'K'] : ['A'], wait }))
  })

  it('allows up to 6 keys in one shortcut', () => {
    const c = defaultConfig()
    c.profiles[0].keys[0].action = {
      type: 'hotkey',
      keys: ['CTRL', 'SHIFT', 'ALT', 'GUI', 'K', 'L']
    }
    expect(validateConfig(c).ok).toBe(true)
    c.profiles[0].keys[0].action = {
      type: 'hotkey',
      keys: ['CTRL', 'SHIFT', 'ALT', 'GUI', 'A', 'B', 'C']
    }
    expect(validateConfig(c).ok).toBe(false)
  })

  it('allows sequences of up to 6 steps with a pause of 0-2000 ms', () => {
    const c = defaultConfig()
    c.profiles[0].keys[0].action = seq(6, 2000)
    expect(validateConfig(c).ok).toBe(true)
    c.profiles[0].keys[0].action = seq(7)
    expect(validateConfig(c).ok).toBe(false)
    c.profiles[0].keys[0].action = seq(3, 2001)
    expect(validateConfig(c).ok).toBe(false)
    c.profiles[0].keys[0].action = seq(3, -1)
    expect(validateConfig(c).ok).toBe(false)
    c.profiles[0].keys[0].action = seq(3, 0)
    expect(validateConfig(c).ok).toBe(true)
  })

  it('migrates old macro actions to sequences with a default pause', () => {
    const old = JSON.parse(JSON.stringify(defaultConfig()))
    old.profiles[2].keys[2].action = { type: 'macro', steps: ['UP', 'ENTER'] }
    old.profiles[2].keys[3].action = {
      type: 'macro',
      steps: [
        ['CTRL', 'K'],
        ['CTRL', 'C']
      ]
    }
    const v = validateConfig(migrateConfig(old))
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.config.profiles[2].keys[2].action).toEqual({
        type: 'sequence',
        steps: [
          { keys: ['UP'], wait: 100 },
          { keys: ['ENTER'], wait: 0 }
        ]
      })
    }
  })

  it('replaces the old "next profile" knob press with a real short-press action', () => {
    const old = JSON.parse(JSON.stringify(defaultConfig()))
    for (const p of old.profiles) {
      p.encoder.press = { type: 'layer_next' }
      delete p.encoder.pressLabel
    }
    const v = validateConfig(migrateConfig(old))
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.config.profiles[0].encoder.press).toEqual({ type: 'consumer', code: 'MUTE' })
      expect(v.config.profiles[0].encoder.pressLabel).toBe('MUTE')
    }
  })

  it('defaults a missing press label to empty and limits it to 5 characters', () => {
    const c = JSON.parse(JSON.stringify(defaultConfig()))
    delete c.profiles[0].encoder.pressLabel
    const v = validateConfig(c)
    expect(v.ok && v.config.profiles[0].encoder.pressLabel).toBe('')
    c.profiles[0].encoder.pressLabel = 'TOOLONG'
    expect(validateConfig(c).ok).toBe(false)
  })

  it('swaps CTRL for GUI in every step on macOS when asked', () => {
    const c = defaultConfig()
    c.profiles[0].keys[0].action = { ...seq(2), cmdOnMac: true }
    const mac = resolveForOs(c, 'macos')
    expect(mac.profiles[0].keys[0].action).toMatchObject({
      steps: [{ keys: ['GUI', 'K'] }, { keys: ['A'] }]
    })
  })
})

describe('sleep time setting', () => {
  const withSleep = (value: unknown): unknown => {
    const c = JSON.parse(JSON.stringify(defaultConfig()))
    c.settings.sleepMinutes = value
    return c
  }

  it('is 2 minutes by default', () => {
    expect(DEFAULT_SLEEP_MINUTES).toBe(2)
    expect(defaultConfig().settings.sleepMinutes).toBe(2)
  })

  it('accepts whole minutes from 0 (never) to the maximum', () => {
    for (const minutes of [0, 1, 2, 30, MAX_SLEEP_MINUTES]) {
      const r = validateConfig(withSleep(minutes))
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.config.settings.sleepMinutes).toBe(minutes)
    }
  })

  it('rejects negative, too large, fractional and non-numeric values', () => {
    for (const bad of [-1, MAX_SLEEP_MINUTES + 1, 1.5, '2', null, true, NaN])
      expect(validateConfig(withSleep(bad)).ok, String(bad)).toBe(false)
  })

  it('gives a config saved before the setting existed the default', () => {
    const old = JSON.parse(JSON.stringify(defaultConfig()))
    delete old.settings.sleepMinutes
    const r = validateConfig(old)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.config.settings.sleepMinutes).toBe(DEFAULT_SLEEP_MINUTES)
  })

  it('is part of what is sent to the pad', () => {
    const c = defaultConfig()
    c.settings.sleepMinutes = 7
    expect(JSON.parse(JSON.stringify(resolveForOs(c, 'windows'))).settings.sleepMinutes).toBe(7)
    expect(JSON.parse(JSON.stringify(resolveForOs(c, 'macos'))).settings.sleepMinutes).toBe(7)
  })
})

describe('key LED effect setting', () => {
  const withEffect = (value: unknown): unknown => {
    const c = JSON.parse(JSON.stringify(defaultConfig()))
    c.settings.effect = value
    return c
  }

  it('is static by default', () => {
    expect(DEFAULT_EFFECT).toBe('static')
    expect(defaultConfig().settings.effect).toBe('static')
  })

  it('lists the effects Studio offers, with the names the firmware knows', () => {
    expect(EFFECTS.map((e) => e.id)).toEqual([
      'static',
      'equalizer',
      'beat',
      'rainbow',
      'ripple',
      'starry'
    ])
  })

  it('accepts every effect', () => {
    for (const { id } of EFFECTS) {
      const r = validateConfig(withEffect(id))
      expect(r.ok, id).toBe(true)
      if (r.ok) expect(r.config.settings.effect).toBe(id)
    }
  })

  it('rejects a name it does not know', () => {
    for (const bad of ['disco', '', null, 3, true])
      expect(validateConfig(withEffect(bad)).ok, String(bad)).toBe(false)
  })

  it('gives a config saved before effects existed static', () => {
    const old = JSON.parse(JSON.stringify(defaultConfig()))
    delete old.settings.effect
    const r = validateConfig(old)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.config.settings.effect).toBe('static')
  })

  it('is part of what is sent to the pad', () => {
    const c = defaultConfig()
    c.settings.effect = 'ripple'
    expect(JSON.parse(JSON.stringify(resolveForOs(c, 'windows'))).settings.effect).toBe('ripple')
    expect(JSON.parse(JSON.stringify(resolveForOs(c, 'macos'))).settings.effect).toBe('ripple')
  })

  it('says where each effect gets its colours', () => {
    const colors = Object.fromEntries(EFFECTS.map((e) => [e.id, e.colors]))
    expect(colors).toEqual({
      static: 'perKey',
      equalizer: 'none',
      beat: 'none',
      rainbow: 'none',
      ripple: 'none',
      starry: 'none'
    })
  })

  it('knows which effects follow the music', () => {
    expect(EFFECTS.filter((e) => isMusicEffect(e.id)).map((e) => e.id)).toEqual([
      'equalizer',
      'beat'
    ])
  })

  it('turns an effect saved while Studio offered breathing or color cycle into static', () => {
    for (const old of ['breathing', 'cycle']) {
      const r = validateConfig(withEffect(old))
      expect(r.ok, old).toBe(true)
      if (r.ok) expect(r.config.settings.effect).toBe('static')
    }
  })
})
