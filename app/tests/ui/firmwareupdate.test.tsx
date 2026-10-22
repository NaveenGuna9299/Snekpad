// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FirmwareUpdateDialog } from '../../src/renderer/src/components/FirmwareUpdateDialog'
import { RESTART_TIMEOUT_MS, VERIFY_MS } from '../../src/renderer/src/lib/useFirmwareUpdate'
import type { DeviceState, SnekApi } from '../../src/shared/api'
import type { FirmwareUpdateResult } from '../../src/shared/firmwareUpdate'
import { installApi } from './stubApi'

const NEW = '0.4.0'
const pad = (firmware: string | undefined, extra: Partial<DeviceState> = {}): DeviceState => ({
  status: 'connected',
  kind: 'serial',
  label: 'SnekPad on COM3',
  events: true,
  firmware,
  ...extra
})
const OLD_PAD = pad('0.3.4')
const GONE: DeviceState = { status: 'disconnected' }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- a test helper: its result is read by the tests next to it
function setup(overrides: Partial<SnekApi> = {}) {
  let resolve!: (r: FirmwareUpdateResult) => void
  const result = new Promise<FirmwareUpdateResult>((r) => (resolve = r))
  const updateFirmware = vi.fn(() => result)
  const cancelFirmwareUpdate = vi.fn(() => Promise.resolve())
  const firmwareInfo = vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      firmware: '0.3.4',
      circuitpython: '10.3.1',
      freeBytes: 1,
      failed: null
    })
  )
  const stub = installApi(OLD_PAD, {
    updateFirmware,
    cancelFirmwareUpdate,
    firmwareInfo,
    ...overrides
  } as unknown as Partial<SnekApi>)
  const onClose = vi.fn()
  const view = render(
    <FirmwareUpdateDialog device={OLD_PAD} bundleVersion={NEW} onClose={onClose} />
  )
  return {
    stub,
    resolve,
    updateFirmware,
    cancelFirmwareUpdate,
    firmwareInfo,
    onClose,
    device: (d: DeviceState): void =>
      view.rerender(<FirmwareUpdateDialog device={d} bundleVersion={NEW} onClose={onClose} />)
  }
}

const click = (name: string): void => {
  fireEvent.click(screen.getByRole('button', { name }))
}
const flush = (ms = 0): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
const text = (): string => document.body.textContent ?? ''

/** Start the update and let the pad take it all the way to "restarting". */
async function sendAll(s: ReturnType<typeof setup>): Promise<void> {
  click('Update pad')
  await flush()
  await act(async () => {
    s.resolve({ ok: true })
  })
}

describe('before it starts', () => {
  it('says what will happen and does nothing until asked', () => {
    const s = setup()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(text()).toContain('0.3.4')
    expect(text()).toContain(NEW)
    expect(text()).toContain('press the knob')
    expect(text()).toContain('keeps its old firmware')
    expect(s.updateFirmware).not.toHaveBeenCalled()
  })

  it('a failed request ends in an error instead of waiting forever', async () => {
    const s = setup({
      updateFirmware: vi.fn(() => Promise.reject(new Error('boom')))
    } as unknown as Partial<SnekApi>)
    click('Update pad')
    await flush()
    expect(screen.getByRole('alert').textContent).toContain('boom')
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(s.onClose).not.toHaveBeenCalled()
  })

  it('Cancel just closes it', () => {
    const s = setup()
    click('Cancel')
    expect(s.onClose).toHaveBeenCalledOnce()
    expect(s.updateFirmware).not.toHaveBeenCalled()
  })

  it('Escape closes it', () => {
    const s = setup()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(s.onClose).toHaveBeenCalledOnce()
  })
})

describe('while it runs', () => {
  it('starts when asked and follows the progress', async () => {
    const s = setup()
    click('Update pad')
    expect(s.updateFirmware).toHaveBeenCalledOnce()
    expect(text()).toContain('Checking the pad')

    await act(async () => s.stub.emitProgress({ phase: 'waiting' }))
    expect(screen.getByRole('status').textContent).toContain('Press the knob on the pad')

    await act(async () =>
      s.stub.emitProgress({ phase: 'sending', file: 'firmware.mpy', sent: 400, total: 1000 })
    )
    expect((screen.getByLabelText('Sending firmware') as HTMLProgressElement).value).toBe(40)
    expect(text()).toContain('firmware.mpy')
    expect(text()).toContain('Do not unplug')

    await act(async () => s.stub.emitProgress({ phase: 'finishing' }))
    expect(text()).toContain('Finishing')
  })

  it('cannot be closed with Escape, and cannot be dismissed, while the pad is being updated', async () => {
    const s = setup()
    click('Update pad')
    await act(async () =>
      s.stub.emitProgress({ phase: 'sending', file: 'firmware.mpy', sent: 1, total: 10 })
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(s.onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })

  it('Cancel asks the main process to stop, and ends as cancelled', async () => {
    const s = setup()
    click('Update pad')
    await act(async () => s.stub.emitProgress({ phase: 'waiting' }))
    click('Cancel')
    expect(s.cancelFirmwareUpdate).toHaveBeenCalledOnce()
    await act(async () => {
      s.resolve({ ok: false, error: 'cancelled', cancelled: true })
    })
    expect(text()).toContain('Cancelled')
    expect(text()).toContain('keeps its old firmware')
    click('Close')
    expect(s.onClose).toHaveBeenCalledOnce()
  })

  it('stops listening for progress once the update has ended', async () => {
    const s = setup()
    click('Update pad')
    expect(s.stub.progressListeners()).toBe(1)
    await act(async () => {
      s.resolve({ ok: false, error: 'crc mismatch' })
    })
    expect(s.stub.progressListeners()).toBe(0)
  })
})

describe('when it fails before anything is installed', () => {
  it('shows why and says the pad keeps its old firmware', async () => {
    const s = setup()
    click('Update pad')
    await act(async () => {
      s.resolve({ ok: false, error: 'not confirmed on the pad' })
    })
    expect(screen.getByRole('alert').textContent).toContain('not confirmed on the pad')
    expect(screen.getByRole('alert').textContent).toContain('The pad keeps its old firmware')
    click('Close')
    expect(s.onClose).toHaveBeenCalledOnce()
  })
})

describe('after the update was sent: the pad restarts and must prove itself', () => {
  it('the pad restarts, comes back on the new firmware, stays up, and only then is it done', async () => {
    const s = setup()
    await sendAll(s)
    expect(screen.getByRole('status').textContent).toContain('restarting')

    s.device(GONE)
    await flush(5000)
    expect(text()).not.toContain('Firmware updated')

    s.device(pad(NEW))
    await flush()
    expect(screen.getByRole('status').textContent).toContain('Checking the new firmware')

    await flush(VERIFY_MS - 1000)
    expect(text()).not.toContain('Firmware updated')
    await flush(1500)
    expect(screen.getByRole('status').textContent).toContain(`Firmware updated to ${NEW}`)
    click('Close')
    expect(s.onClose).toHaveBeenCalledOnce()
  })

  describe('a pad that restarts without disconnecting (the real pad)', () => {
    const PENDING: DeviceState = { status: 'connected', kind: 'serial', label: 'SnekPad on COM3' } // greeted, not answered

    it('goes quiet after the update was sent, then reports the new firmware, and stays up: done', async () => {
      const s = setup()
      await sendAll(s)
      s.device(PENDING) // Studio greets the pad again; it has not answered
      await flush(3000)
      expect(screen.getByRole('status').textContent).toContain('restarting')
      expect(screen.queryByRole('alert')).toBeNull()
      s.device(pad(NEW))
      await flush()
      expect(screen.getByRole('status').textContent).toContain('Checking the new firmware')
      await flush(VERIFY_MS + 500)
      expect(screen.getByRole('status').textContent).toContain(`Firmware updated to ${NEW}`)
    })

    it('a pad that answers as the OLD firmware again undid the update: says why', async () => {
      const s = setup({
        firmwareInfo: vi.fn(() =>
          Promise.resolve({
            ok: true as const,
            firmware: '0.3.4',
            circuitpython: '10.3.1',
            freeBytes: 1,
            failed: 'new firmware did not start'
          })
        )
      })
      await sendAll(s)
      s.device(PENDING)
      await flush(3000)
      s.device(pad('0.3.4'))
      await flush()
      const alert = screen.getByRole('alert').textContent ?? ''
      expect(alert).toContain('went back to its old firmware 0.3.4')
      expect(alert).toContain('new firmware did not start')
    })

    it('a pad that never answers again is reported after the time limit', async () => {
      const s = setup()
      await sendAll(s)
      s.device(PENDING)
      await flush(RESTART_TIMEOUT_MS + 1000)
      expect(screen.getByRole('alert').textContent).toContain('did not come back')
    })

    it('never tells the user to unplug the pad', async () => {
      const s = setup()
      await sendAll(s)
      s.device(PENDING)
      await flush(RESTART_TIMEOUT_MS + 1000)
      expect(screen.getByRole('alert').textContent).not.toMatch(/unplug/i)
    })

    it('the old state from before the restart is not mistaken for the pad undoing the update', async () => {
      const s = setup()
      await sendAll(s) // Studio still shows the pad as connected on 0.3.4: it has not restarted yet
      await flush(2000)
      expect(screen.queryByRole('alert')).toBeNull()
      expect(s.firmwareInfo).not.toHaveBeenCalled()
    })
  })

  it('does not take the connection from before the restart for a failure', async () => {
    const s = setup()
    await sendAll(s)
    await flush(5000) // the pad is still listed as connected on the old firmware: it has not restarted yet
    expect(text()).toContain('restarting')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(s.firmwareInfo).not.toHaveBeenCalled()
  })

  it('does not take a pad that has not said its firmware yet for a failure', async () => {
    const s = setup()
    await sendAll(s)
    s.device(GONE)
    await flush(1000)
    s.device({ status: 'connected', kind: 'serial', label: 'SnekPad on COM3' }) // connected, HELLO not answered yet
    await flush(1000)
    expect(screen.queryByRole('alert')).toBeNull()
    s.device(pad(NEW))
    await flush()
    expect(text()).toContain('Checking the new firmware')
  })

  it('if the pad comes back on the OLD firmware it undid the update: says why, and nothing is lost', async () => {
    const s = setup({
      firmwareInfo: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          firmware: '0.3.4',
          circuitpython: '10.3.1',
          freeBytes: 1,
          failed: 'new firmware did not start'
        })
      )
    })
    await sendAll(s)
    s.device(GONE)
    await flush(3000)
    s.device(pad('0.3.4'))
    await flush()
    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toContain('went back to its old firmware 0.3.4')
    expect(alert).toContain('new firmware did not start')
    expect(alert).toContain('works as before')
  })

  it('asks the pad why only once, even though its state changes several times as it reconnects', async () => {
    // the real pad reports the reason once: a second question gets none, and must not wipe out the first answer
    let asked = 0
    const firmwareInfo = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        firmware: '0.3.4',
        circuitpython: '10.3.1',
        freeBytes: 1,
        failed: ++asked === 1 ? 'new firmware did not start' : null
      })
    )
    const s = setup({ firmwareInfo })
    await sendAll(s)
    s.device(GONE)
    await flush(3000)
    // it comes back on the old firmware, and then more state arrives (the active profile) before the first answer
    s.device(pad('0.3.4'))
    s.device(pad('0.3.4', { activeProfile: 0 }))
    s.device(pad('0.3.4', { activeProfile: 1 }))
    await flush()
    expect(firmwareInfo).toHaveBeenCalledOnce()
    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toContain('went back to its old firmware 0.3.4')
    expect(alert).toContain('(new firmware did not start)')
  })

  it('also notices the pad undoing the update while it is still being checked', async () => {
    const s = setup()
    await sendAll(s)
    s.device(GONE)
    await flush(2000)
    s.device(pad(NEW)) // it starts on the new firmware ...
    await flush(5000)
    expect(text()).toContain('Checking the new firmware')
    s.device(GONE) // ... and crashes: the pad restarts
    await flush(3000)
    s.device(pad('0.3.4')) // ... and the safety net brings the old firmware back
    await flush()
    expect(screen.getByRole('alert').textContent).toContain('went back to its old firmware')
    await flush(VERIFY_MS * 2)
    expect(text()).not.toContain('Firmware updated')
  })

  it('the stay-up time starts over if the pad drops out and returns on the new firmware', async () => {
    const s = setup()
    await sendAll(s)
    s.device(GONE)
    await flush(1000)
    s.device(pad(NEW))
    await flush(VERIFY_MS - 2000)
    s.device(GONE)
    await flush(1000)
    s.device(pad(NEW))
    await flush(VERIFY_MS - 2000) // not enough since the pad came back again
    expect(text()).not.toContain('Firmware updated')
    await flush(3000)
    expect(text()).toContain(`Firmware updated to ${NEW}`)
  })

  it('a pad that never comes back is reported, with what to do', async () => {
    const s = setup()
    await sendAll(s)
    s.device(GONE)
    await flush(RESTART_TIMEOUT_MS + 1000)
    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toContain('did not come back')
    expect(alert).toContain('keep it plugged in')
    expect(alert).not.toMatch(/unplug/i)
    expect(alert).not.toContain('keeps its old firmware') // it may already have been replaced: no false promise
  })

  it('cannot be closed while the pad is restarting or being checked', async () => {
    const s = setup()
    await sendAll(s)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(s.onClose).not.toHaveBeenCalled()
    s.device(GONE)
    await flush(1000)
    s.device(pad(NEW))
    await flush()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(s.onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })
})
