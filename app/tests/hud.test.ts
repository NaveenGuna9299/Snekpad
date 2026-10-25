import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, screen: {}, ipcMain: { on: () => {} } }))

import { hudData } from '../src/main/hud'
import { defaultConfig, FN_KEY } from '../src/shared/config'
import { clampOpacity, DEFAULT_HUD, hudPatchSchema, hudPrefSchema } from '../src/shared/hud'

describe('HUD', () => {
  it('shows each key with its label, colour and what it does', () => {
    const p = defaultConfig().profiles[0]
    const d = hudData(p)
    expect(d.name).toBe(p.name)
    expect(d.knob).toBe(p.encoder.label)
    expect(d.keys).toHaveLength(12)
    expect(d.keys[FN_KEY].label).toBe(p.keys[FN_KEY].label || 'FN')
    d.keys.forEach((k, i) => expect(k.color).toBe(p.keys[i].color))
  })

  it('describes a key that has no label, and dims a key that does nothing', () => {
    const p = structuredClone(defaultConfig().profiles[0])
    p.keys[0] = { label: '', color: '#ff0000', action: { type: 'hotkey', keys: ['CTRL', 'C'] } }
    p.keys[1] = { label: '', color: '#000000', action: { type: 'none' } }
    const d = hudData(p)
    expect(d.keys[0]).toMatchObject({ label: 'CTRL + C', text: '', none: false })
    expect(d.keys[1]).toMatchObject({ none: true })
  })

  it('falls back to the defaults for a missing or damaged setting', () => {
    expect(hudPrefSchema.parse({ mode: 'loud', corner: 'middle' })).toEqual(DEFAULT_HUD)
    // a file saved before sizes, opacity and a free position existed
    expect(hudPrefSchema.parse({ mode: 'pinned', corner: 'top-left' })).toEqual({
      ...DEFAULT_HUD,
      mode: 'pinned',
      corner: 'top-left'
    })
    expect(hudPrefSchema.parse({ size: 'slim', opacity: 0.5, pos: { x: 3, y: 4 } })).toMatchObject({
      size: 'slim',
      opacity: 0.5,
      pos: { x: 3, y: 4 }
    })
    expect(hudPrefSchema.parse({ opacity: 7, pos: { x: 'a' } })).toMatchObject({
      opacity: 0.9,
      pos: null
    })
  })

  it('refuses a bad change instead of quietly using the default', () => {
    expect(hudPatchSchema.safeParse({ size: 'slim' }).success).toBe(true)
    expect(hudPatchSchema.safeParse({ size: 'huge' }).success).toBe(false)
    expect(hudPatchSchema.safeParse({ opacity: 0.05 }).success).toBe(false)
    expect(hudPatchSchema.safeParse({ pos: { x: 1.5, y: 2 } }).success).toBe(false)
    expect(hudPatchSchema.safeParse({ pos: null }).success).toBe(true)
    expect(hudPatchSchema.safeParse({ other: 1 }).success).toBe(false)
  })

  it('keeps the opacity in range and in whole percents', () => {
    expect(clampOpacity(0.30000000000000004)).toBe(0.3)
    expect(clampOpacity(0)).toBe(0.2)
    expect(clampOpacity(3)).toBe(1)
  })
})
