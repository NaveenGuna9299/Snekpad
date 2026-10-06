import { describe, expect, it } from 'vitest'
import { defaultConfig, validateConfig } from '../src/shared/config'
import { PRESETS } from '../src/renderer/src/lib/presets'

describe('preset profiles', () => {
  it('each one is a valid profile', () => {
    for (const preset of PRESETS) {
      const cfg = defaultConfig()
      cfg.profiles = [cfg.profiles[0], { ...preset.profile, id: 'preset' }]
      const r = validateConfig(cfg)
      expect(r.ok ? [] : r.errors, preset.id).toEqual([])
    }
  })
})
