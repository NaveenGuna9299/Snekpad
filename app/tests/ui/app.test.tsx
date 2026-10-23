// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../src/renderer/src/App'
import { REQUIRED_FIRMWARE } from '../../src/shared/firmware'
import type { DeviceState, SnekApi } from '../../src/shared/api'
import { defaultConfig, type Config } from '../../src/shared/config'
import { liveViewOf } from '../../src/shared/protocol'
import { installApi, type StubApi } from './stubApi'

const pad = (extra: Partial<DeviceState> = {}): DeviceState => ({
  status: 'connected',
  kind: 'serial',
  label: 'SnekPad on COM3',
  events: true,
  firmware: REQUIRED_FIRMWARE,
  ...extra
})

async function start(
  device: DeviceState = { status: 'disconnected' },
  overrides: Partial<SnekApi> = {}
): Promise<StubApi> {
  const stub = installApi(device, overrides)
  render(<App />)
  await screen.findByRole('button', { name: 'Open SnekPad settings' }) // the config has loaded
  return stub
}

describe('App', () => {
  it('tells the main process whether a music effect is chosen, so closing the window can keep it going from the tray', async () => {
    const withEffect = (effect: Config['settings']['effect']): Config => {
      const c = defaultConfig()
      c.settings.effect = effect
      return c
    }
    for (const [effect, expected] of [
      ['equalizer', true],
      ['beat', true],
      ['static', false],
      ['rainbow', false]
    ] as const) {
      const setMusicActive = vi.fn()
      await start(pad(), {
        loadConfig: () => Promise.resolve(withEffect(effect)),
        setMusicActive
      })
      await waitFor(() => expect(setMusicActive).toHaveBeenCalledWith(expected), { timeout: 2000 })
      expect(setMusicActive).not.toHaveBeenCalledWith(!expected)
      document.body.innerHTML = ''
    }
  })

  it('does not break when the sound cannot be listened to (no pad, or a system without it)', async () => {
    const sendMusic = vi.fn()
    const c = defaultConfig()
    c.settings.effect = 'beat'
    await start(pad(), { loadConfig: () => Promise.resolve(c), sendMusic })
    await userEvent.click(screen.getByRole('button', { name: 'Lighting effects' }))
    // jsdom has no media devices: Studio says so instead of failing
    expect(
      await screen.findByText(/could not|Listening needs|Cannot read|not a function|undefined/i)
    ).toBeTruthy()
    expect(sendMusic).not.toHaveBeenCalled()
  })

  it('opens on the home screen and goes into the editor and back', async () => {
    await start()
    expect(screen.getByText('Not connected')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open SnekPad settings' }))
    expect(screen.getByRole('button', { name: 'Push to pad' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Home' }))
    expect(screen.getByText('Not connected')).toBeTruthy()
  })

  it('has no firmware warning for a pad with current firmware', async () => {
    await start(pad())
    expect((await screen.findAllByText('SnekPad on COM3')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('warns about old firmware, and the warning can be dismissed', async () => {
    await start(pad({ firmware: '0.1.0' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('0.1.0')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss firmware warning' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the firmware warning again when the pad is plugged in again', async () => {
    const stub = await start(pad({ firmware: undefined }))
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss firmware warning' }))
    act(() => stub.setDevice({ status: 'disconnected' }))
    await waitFor(() => expect(screen.getByText('Not connected')).toBeTruthy())
    act(() => stub.setDevice(pad({ firmware: undefined })))
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('a pad that reports the new firmware clears the warning', async () => {
    const stub = await start(pad({ firmware: '0.1.0' }))
    await screen.findByRole('alert')
    act(() => stub.setDevice(pad()))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('sends the pad sleep time set in Settings when pushing, and saves it', async () => {
    const push = vi.fn((c: Config) => {
      void c
      return Promise.resolve({ ok: true as const })
    })
    const saveConfig = vi.fn(() => Promise.resolve({ ok: true as const }))
    await start(pad(), { push, saveConfig } as unknown as Partial<SnekApi>)

    await userEvent.click(screen.getByRole('button', { name: /Settings/ }))
    const input = screen.getByLabelText('Pad sleeps after') as HTMLInputElement
    expect(input.value).toBe('2') // the default
    await userEvent.clear(input)
    await userEvent.type(input, '7')
    await userEvent.click(screen.getByRole('button', { name: 'Open SnekPad settings' }))

    expect(screen.getByText('Changes not on the pad yet')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Push to pad' }))
    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(push.mock.calls[0][0].settings.sleepMinutes).toBe(7)
    await waitFor(() => expect(saveConfig).toHaveBeenCalled())
  })

  it('reads the sleep time from the pad when it connects', async () => {
    const view = liveViewOf(defaultConfig())
    view.s = 5 // the pad is set to 5 minutes, the app to the default 2
    const saveBaseline = vi.fn(() => Promise.resolve())
    const stub = await start({ status: 'disconnected' }, {
      pull: () => Promise.resolve({ ok: true as const, view }),
      saveBaseline
    } as unknown as Partial<SnekApi>)

    await userEvent.click(screen.getByRole('button', { name: /Settings/ }))
    const input = screen.getByLabelText('Pad sleeps after') as HTMLInputElement
    expect(input.value).toBe('2')

    act(() => stub.setDevice(pad()))
    await waitFor(() => expect(input.value).toBe('5'))
    expect(screen.getByText('Pad is up to date')).toBeTruthy() // what the app shows is what the pad has
    await waitFor(() => expect(saveBaseline).toHaveBeenCalled())
  })

  it('does not replace a sleep time you changed and have not sent yet', async () => {
    const view = liveViewOf(defaultConfig())
    view.s = 5
    const pull = vi.fn(() => Promise.resolve({ ok: true as const, view }))
    const stub = await start({ status: 'disconnected' }, {
      loadBaseline: () => Promise.resolve(defaultConfig()), // the pad is known to have the starter config
      pull
    } as unknown as Partial<SnekApi>)

    await userEvent.click(screen.getByRole('button', { name: /Settings/ }))
    const input = screen.getByLabelText('Pad sleeps after') as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, '7')

    act(() => stub.setDevice(pad()))
    await waitFor(() => expect(pull).toHaveBeenCalled())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(input.value).toBe('7')
    expect(screen.getByText('Changes not on the pad yet')).toBeTruthy()
  })

  it('keeps its own sleep time when an older pad does not report one', async () => {
    const view = liveViewOf(defaultConfig())
    delete view.s
    const pull = vi.fn(() => Promise.resolve({ ok: true as const, view }))
    const stub = await start({ status: 'disconnected' }, { pull } as unknown as Partial<SnekApi>)
    await userEvent.click(screen.getByRole('button', { name: /Settings/ }))
    const input = screen.getByLabelText('Pad sleeps after') as HTMLInputElement
    act(() => stub.setDevice(pad()))
    await waitFor(() => expect(pull).toHaveBeenCalled())
    expect(input.value).toBe('2')
  })

  describe('firmware update', () => {
    const bundleOk = {
      firmwareBundle: () =>
        Promise.resolve({
          ok: true as const,
          version: '9.0.0',
          circuitpython: '10.3.1',
          files: 8,
          bytes: 33070
        })
    } as unknown as Partial<SnekApi>

    it('offers to update a pad that is older than the firmware in this build', async () => {
      await start(pad({ firmware: '0.3.4' }), bundleOk)
      const strip = await screen.findByRole('alert')
      expect(strip.textContent).toContain('older than the firmware in this app (9.0.0)')
      expect(screen.getByRole('button', { name: 'Update pad' })).toBeTruthy()
    })

    it('opens the update dialog from the strip, and Cancel closes it again', async () => {
      await start(pad({ firmware: '0.3.4' }), bundleOk)
      await userEvent.click(await screen.findByRole('button', { name: 'Update pad' }))
      const dialog = screen.getByRole('dialog')
      expect(dialog.textContent).toContain('0.3.4')
      expect(dialog.textContent).toContain('9.0.0')
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('can be started from Settings too, even after the strip was dismissed', async () => {
      await start(pad({ firmware: '0.3.4' }), bundleOk)
      await userEvent.click(await screen.findByRole('button', { name: 'Dismiss firmware warning' }))
      expect(screen.queryByRole('alert')).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: /Settings/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Update pad firmware…' }))
      expect(screen.getByRole('dialog')).toBeTruthy()
    })

    it('starts sending when asked', async () => {
      const updateFirmware = vi.fn(() => new Promise(() => {})) // never ends: we only look at the start
      await start(pad({ firmware: '0.3.4' }), {
        ...bundleOk,
        updateFirmware
      } as unknown as Partial<SnekApi>)
      await userEvent.click(await screen.findByRole('button', { name: 'Update pad' }))
      await userEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Update pad' })
      )
      expect(updateFirmware).toHaveBeenCalledOnce()
      expect(screen.getByRole('dialog').textContent).toContain('Checking the pad')
    })

    it('says an old pad needs one flash from the computer, and offers no update button', async () => {
      await start(pad({ firmware: '0.3.3' }), bundleOk)
      const strip = await screen.findByRole('alert')
      expect(strip.textContent).toContain('one flash from the computer')
      expect(screen.queryByRole('button', { name: 'Update pad' })).toBeNull()
    })

    it('offers nothing when the pad has the same firmware as this build', async () => {
      await start(pad({ firmware: '9.0.0' }), bundleOk)
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Update pad' })).toBeNull()
    })

    it('a build without a firmware bundle never offers an update', async () => {
      await start(pad({ firmware: '0.1.0' }))
      const strip = await screen.findByRole('alert')
      expect(strip.textContent).toContain('older than this app expects')
      expect(screen.queryByRole('button', { name: 'Update pad' })).toBeNull()
    })
  })

  it('has no key test in the production build', async () => {
    vi.stubGlobal('__DEV_TOOLS__', false)
    await start(pad())
    expect(screen.queryByRole('button', { name: 'Test keys' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open SnekPad settings' })).toBeTruthy()
  })

  it('has the key test in a build with the development tools', async () => {
    await start(pad())
    expect(screen.getByRole('button', { name: 'Test keys' })).toBeTruthy()
  })

  it('opens the key test from home, counts a key press, and comes back', async () => {
    const stub = await start(pad())
    await userEvent.click(screen.getByRole('button', { name: 'Test keys' }))
    expect(screen.getByRole('heading', { name: 'Key test' })).toBeTruthy()
    act(() => stub.emitKey(0, true))
    expect(screen.getByText('1 of 12 keys tested')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getAllByText('SnekPad on COM3').length).toBeGreaterThan(0)
  })
})
