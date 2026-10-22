// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FirmwareNotice } from '../../src/renderer/src/components/FirmwareNotice'
import { REQUIRED_FIRMWARE } from '../../src/shared/firmware'
import type { DeviceState } from '../../src/shared/api'
import { installApi } from './stubApi'

const connected = (extra: Partial<DeviceState>): DeviceState => ({
  status: 'connected',
  kind: 'serial',
  label: 'SnekPad',
  ...extra
})

describe('FirmwareNotice', () => {
  it.each([
    ['no pad', { status: 'disconnected' } as DeviceState],
    ['a pad that has not answered yet', connected({})],
    ['current firmware', connected({ events: true, firmware: REQUIRED_FIRMWARE })]
  ])('shows nothing for %s', (_name, device) => {
    installApi()
    const { container } = render(
      <FirmwareNotice
        bundleVersion={null}
        onUpdate={() => {}}
        device={device}
        onDismiss={() => {}}
      />
    )
    expect(container.textContent).toBe('')
  })

  it('warns about an older firmware and names its version', () => {
    installApi()
    render(
      <FirmwareNotice
        device={connected({ events: true, firmware: '0.1.0' })}
        onDismiss={() => {}}
      />
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('0.1.0')
    expect(alert.textContent).toContain(REQUIRED_FIRMWARE)
  })

  it('warns about a pad that never answered HELLO', () => {
    installApi()
    render(
      <FirmwareNotice
        bundleVersion={null}
        onUpdate={() => {}}
        device={connected({ legacy: true })}
        onDismiss={() => {}}
      />
    )
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('can be dismissed and opens the release page', async () => {
    const stub = installApi()
    const dismiss = vi.fn()
    render(
      <FirmwareNotice
        bundleVersion={null}
        onUpdate={() => {}}
        device={connected({ legacy: true })}
        onDismiss={dismiss}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Open the release page' }))
    expect(stub.api.openReleasePage).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss firmware warning' }))
    expect(dismiss).toHaveBeenCalledOnce()
  })
})
