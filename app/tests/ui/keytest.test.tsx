// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { KeyTest } from '../../src/renderer/src/components/KeyTest'
import { defaultConfig, KEY_COUNT } from '../../src/shared/config'
import { REQUIRED_FIRMWARE } from '../../src/shared/firmware'
import type { DeviceState } from '../../src/shared/api'
import { installApi } from './stubApi'

const profile = defaultConfig().profiles[0]
// a development pad (flash_pad.ps1 -Dev): silences its keys during the test and reports the knob
const reporting: DeviceState = {
  status: 'connected',
  kind: 'serial',
  label: 'SnekPad',
  events: true,
  firmware: REQUIRED_FIRMWARE,
  dev: true
}

const result = (i: number): HTMLElement => screen.getByTestId(`key-result-${i}`)
const idle = (device: DeviceState, pressed = new Set<number>(), onBack = () => {}): void => {
  render(<KeyTest profile={profile} device={device} pressed={pressed} onBack={onBack} />)
}

describe('KeyTest', () => {
  it('asks for a pad when none is connected', () => {
    installApi()
    idle({ status: 'disconnected' })
    expect(screen.getByText(/No pad found/)).toBeTruthy()
    expect(screen.getByText('0 of 12 keys tested')).toBeTruthy()
  })

  it('explains that a pad without key reports needs a firmware update', () => {
    installApi()
    idle({ status: 'connected', kind: 'serial', label: 'SnekPad' })
    expect(screen.getByText(/does not report key presses/)).toBeTruthy()
  })

  it('has no warning when the pad is a development flash', () => {
    installApi(reporting)
    idle(reporting)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('warns that a customer pad will still type its shortcuts, however new its firmware', () => {
    installApi()
    idle({ ...reporting, dev: undefined, firmware: '99.0.0' })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('still does its normal job')
    expect(alert.textContent).toContain('flash_pad.ps1 -Dev')
  })

  it('warns the same for a pad that reports no firmware version', () => {
    installApi()
    idle({ ...reporting, dev: undefined, firmware: undefined })
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('counts knob turns and presses, and Reset clears them too', async () => {
    const stub = installApi(reporting)
    idle(reporting)
    expect(screen.getByText('Knob: 0 of 3 actions tested')).toBeTruthy()
    act(() => {
      stub.emitKnob('cw')
      stub.emitKnob('cw')
      stub.emitKnob('cw')
      stub.emitKnob('ccw')
    })
    expect(within(screen.getByTestId('knob-result-cw')).getByText('✓ 3')).toBeTruthy()
    expect(within(screen.getByTestId('knob-result-ccw')).getByText('✓ 1')).toBeTruthy()
    expect(within(screen.getByTestId('knob-result-press')).getByText('–')).toBeTruthy()
    expect(screen.getByText('Knob: 2 of 3 actions tested')).toBeTruthy()
    act(() => stub.emitKnob('press'))
    expect(screen.getByText('Knob: 3 of 3 actions tested')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByText('Knob: 0 of 3 actions tested')).toBeTruthy()
  })

  it('knob events do not count as key presses', () => {
    const stub = installApi(reporting)
    idle(reporting)
    act(() => stub.emitKnob('press'))
    expect(screen.getByText('0 of 12 keys tested')).toBeTruthy()
  })

  it('ticks off each key the pad reports and counts its presses', () => {
    const stub = installApi(reporting)
    idle(reporting)
    act(() => {
      stub.emitKey(3, true)
      stub.emitKey(3, false)
      stub.emitKey(3, true)
      stub.emitKey(3, false)
      stub.emitKey(7, true)
    })
    expect(within(result(3)).getByText('✓ 2')).toBeTruthy()
    expect(within(result(7)).getByText('✓ 1')).toBeTruthy()
    expect(within(result(0)).getByText('–')).toBeTruthy()
    expect(screen.getByText('2 of 12 keys tested')).toBeTruthy()
  })

  it('a key release alone is not a press', () => {
    const stub = installApi(reporting)
    idle(reporting)
    act(() => stub.emitKey(5, false))
    expect(screen.getByText('0 of 12 keys tested')).toBeTruthy()
  })

  it('says all keys work once every key was seen, and Reset starts over', async () => {
    const stub = installApi(reporting)
    idle(reporting)
    act(() => {
      for (let i = 0; i < KEY_COUNT; i++) stub.emitKey(i, true)
    })
    expect(screen.getByText(/12 of 12 keys tested/).textContent).toContain('all keys work')
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByText('0 of 12 keys tested')).toBeTruthy()
    expect(within(result(0)).getByText('–')).toBeTruthy()
  })

  it('highlights the keys held down right now', () => {
    installApi(reporting)
    idle(reporting, new Set([2]))
    expect(result(2).className).toContain('border-accent')
    expect(result(1).className).not.toContain('border-accent')
  })

  it('labels the bottom-right key FN', () => {
    installApi(reporting)
    idle(reporting)
    expect(within(result(11)).getByText('FN')).toBeTruthy()
  })

  it('tells the main process to ignore shortcuts while open, and stops when left', () => {
    const setKeyTest = vi.fn(() => Promise.resolve())
    installApi(reporting, { setKeyTest })
    const { unmount } = render(
      <KeyTest profile={profile} device={reporting} pressed={new Set()} onBack={() => {}} />
    )
    expect(setKeyTest).toHaveBeenCalledTimes(1)
    expect(setKeyTest).toHaveBeenLastCalledWith(true)
    unmount()
    expect(setKeyTest).toHaveBeenCalledTimes(2)
    expect(setKeyTest).toHaveBeenLastCalledWith(false)
  })

  it('Back goes back, and leaving stops listening to the pad', async () => {
    const stub = installApi(reporting)
    const back = vi.fn()
    const { unmount } = render(
      <KeyTest profile={profile} device={reporting} pressed={new Set()} onBack={back} />
    )
    expect(stub.eventListeners()).toBe(1)
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(back).toHaveBeenCalledOnce()
    unmount()
    expect(stub.eventListeners()).toBe(0)
  })
})
