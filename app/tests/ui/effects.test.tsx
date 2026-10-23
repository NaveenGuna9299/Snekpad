// @vitest-environment jsdom
import { render, screen, within, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { Effects } from '../../src/renderer/src/components/Effects'
import { defaultConfig, EFFECTS, type EffectId } from '../../src/shared/config'
import type { DeviceState } from '../../src/shared/api'
import type { SyncStatus } from '../../src/shared/sync'
import type { MusicState } from '../../src/renderer/src/lib/useMusic'
import { installApi } from './stubApi'

const connected: DeviceState = { status: 'connected', label: 'SnekPad', firmware: '0.4.0' }

type Options = {
  effect?: EffectId
  device?: DeviceState
  sync?: SyncStatus
  music?: Partial<MusicState>
}

type Rendered = {
  onEffect: Mock
  onKeyColor: Mock
  onAllColors: Mock
  onPush: Mock
  onBack: Mock
  view: RenderResult
}

function setup(options: Options = {}): Rendered {
  installApi()
  const fns = {
    onEffect: vi.fn(),
    onKeyColor: vi.fn(),
    onAllColors: vi.fn(),
    onPush: vi.fn(),
    onBack: vi.fn()
  }
  const view = render(
    <Effects
      profiles={defaultConfig().profiles}
      effect={options.effect ?? 'static'}
      device={options.device ?? connected}
      sync={options.sync ?? 'in-sync'}
      music={{ status: 'off', bands: [0, 0, 0, 0], beat: 0, ...options.music }}
      pushing={false}
      {...fns}
    />
  )
  return { ...fns, view }
}

describe('Effects page', () => {
  it('shows the six effects and marks the one the pad runs', () => {
    setup({ effect: 'ripple' })
    const group = screen.getByRole('radiogroup', { name: 'Effect' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((r) => r.textContent)).toEqual(EFFECTS.map((e) => e.label))
    expect(within(group).getByRole('radio', { name: 'Ripple' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    expect(within(group).getByRole('radio', { name: 'Static' }).getAttribute('aria-checked')).toBe(
      'false'
    )
  })

  it('picks an effect on click', async () => {
    const { onEffect } = setup()
    await userEvent.click(screen.getByRole('radio', { name: 'Rainbow' }))
    expect(onEffect).toHaveBeenCalledWith('rainbow')
  })

  it('describes the chosen effect', () => {
    setup({ effect: 'ripple' })
    expect(screen.getByText(/ring of a random colour/)).toBeTruthy()
  })

  it('offers the per-key colours for static', () => {
    setup({ effect: 'static' })
    expect(screen.getByLabelText('Hex colour')).toBeTruthy()
    expect(screen.getByRole('tablist', { name: 'Profile' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Apply to all keys' })).toBeTruthy()
  })

  it('shows what Studio hears for the music effects, bar by bar', () => {
    for (const id of ['equalizer', 'beat'] as const) {
      const { view } = setup({
        effect: id,
        music: { status: 'listening', bands: [63, 32, 0, 10], beat: 40 }
      })
      expect(screen.getByText(/Listening to the sound/)).toBeTruthy()
      expect(screen.getByTestId('band-0').style.height).toBe('100%')
      expect(screen.getByTestId('band-1').style.height).toBe('51%')
      expect(screen.getByTestId('band-2').style.height).toBe('0%')
      expect(screen.getByTestId('band-3').style.height).toBe('16%')
      expect(screen.getByTestId('beat-dot').className).toContain('bg-accent')
      expect(screen.queryByLabelText('Hex colour'), id).toBeNull()
      view.unmount()
    }
  })

  it('says what is going on while the music effect is starting, failing, or has no pad', () => {
    const cases: [Partial<MusicState>, DeviceState, RegExp][] = [
      [{ status: 'starting' }, connected, /Starting to listen/],
      [{ status: 'error', error: 'No sound here' }, connected, /No sound here/],
      [{ status: 'off' }, connected, /once the pad is connected/],
      [{ status: 'off' }, { status: 'disconnected' }, /Connect your pad/]
    ]
    for (const [music, device, text] of cases) {
      const { view } = setup({ effect: 'beat', music, device })
      expect(screen.getByText(text)).toBeTruthy()
      view.unmount()
    }
  })

  it('has no colours to set for the effects that make their own', () => {
    for (const id of ['rainbow', 'ripple', 'starry'] as const) {
      const { view } = setup({ effect: id })
      expect(screen.queryByLabelText('Hex colour'), id).toBeNull()
      expect(screen.getByText(/makes its own colours/)).toBeTruthy()
      view.unmount()
    }
  })

  it('changes the colour of the selected key of the selected profile', async () => {
    const { onKeyColor } = setup()
    await userEvent.click(screen.getAllByRole('button', { name: /^Colour #/ })[0])
    expect(onKeyColor).toHaveBeenCalledTimes(1)
    const [profile, key, color] = onKeyColor.mock.calls[0]
    expect([profile, key]).toEqual([0, 0])
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('applies a colour to every key of the profile being edited', async () => {
    const { onAllColors } = setup()
    await userEvent.click(screen.getByRole('tab', { name: defaultConfig().profiles[1].name }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply to all keys' }))
    expect(onAllColors).toHaveBeenCalledWith(1, expect.stringMatching(/^#[0-9a-fA-F]{6}$/))
  })

  it('pushes to the pad, and goes back home', async () => {
    const { onPush, onBack } = setup({ sync: 'unsent' })
    expect(screen.getByText('Changes not on the pad yet')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Push to pad' }))
    expect(onPush).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Home' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('cannot push without a pad', () => {
    setup({ device: { status: 'disconnected' } })
    expect(
      (screen.getByRole('button', { name: 'Push to pad' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('warns when the pad firmware is too old to play effects', () => {
    setup({ device: { status: 'connected', label: 'SnekPad', firmware: '0.3.5' } })
    expect(screen.getByRole('alert').textContent).toMatch(/0\.3\.5.*0\.4\.0/)
  })

  it('does not warn with current firmware or while no pad is connected', () => {
    const { view } = setup()
    expect(screen.queryByRole('alert')).toBeNull()
    view.unmount()
    setup({ device: { status: 'disconnected' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
