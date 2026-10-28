// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FirmwareNotice } from '../../src/renderer/src/components/FirmwareNotice'
import { SettingsMenu } from '../../src/renderer/src/components/SettingsMenu'
import { OTA_FIRMWARE, OTA_NEW_FILES_FIRMWARE, updateOffer } from '../../src/shared/firmware'
import type { DeviceState } from '../../src/shared/api'
import { installApi } from './stubApi'

const BUNDLE = '9.0.0'
const pad = (extra: Partial<DeviceState> = {}): DeviceState => ({
  status: 'connected',
  kind: 'serial',
  label: 'SnekPad',
  events: true,
  ...extra
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- a test helper: its result is read by the tests next to it
function notice(device: DeviceState, bundleVersion: string | null = BUNDLE) {
  const stub = installApi(device)
  const onUpdate = vi.fn()
  const onDismiss = vi.fn()
  const view = render(
    <FirmwareNotice
      device={device}
      bundleVersion={bundleVersion}
      onUpdate={onUpdate}
      onDismiss={onDismiss}
    />
  )
  return { stub, onUpdate, onDismiss, view }
}

describe('FirmwareNotice: a pad that can take the update', () => {
  it('offers an Update pad button and opens the update when it is pressed', () => {
    const n = notice(pad({ firmware: OTA_NEW_FILES_FIRMWARE }))
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(
      `Pad firmware ${OTA_NEW_FILES_FIRMWARE} is older than the firmware in this app (${BUNDLE})`
    )
    fireEvent.click(screen.getByRole('button', { name: 'Update pad' }))
    expect(n.onUpdate).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Open the release page' })).toBeNull()
  })

  it('does not offer the button to a pad that would refuse the new files in the bundle (it needs a flash first)', () => {
    notice(pad({ firmware: OTA_FIRMWARE }))
    expect(screen.queryByRole('button', { name: 'Update pad' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('one flash from the computer')
  })

  it('can be dismissed', () => {
    const n = notice(pad({ firmware: OTA_FIRMWARE }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss firmware warning' }))
    expect(n.onDismiss).toHaveBeenCalledOnce()
  })

  it('is not shown when the pad has the bundled firmware or newer', () => {
    const { view } = notice(pad({ firmware: BUNDLE }))
    expect(view.container.textContent).toBe('')
  })
})

describe('FirmwareNotice: a pad too old to update itself', () => {
  it('says it needs one flash from the computer first, and points to the release page', () => {
    const n = notice(pad({ firmware: '0.3.3' }))
    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toContain('one flash from the computer')
    expect(alert).toContain('updates run from Studio')
    expect(screen.queryByRole('button', { name: 'Update pad' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open the release page' }))
    expect(n.stub.api.openReleasePage).toHaveBeenCalledOnce()
  })

  it('also for a pad that reports no firmware version at all', () => {
    notice(pad())
    expect(screen.getByRole('alert').textContent).toContain('one flash from the computer')
    expect(screen.queryByRole('button', { name: 'Update pad' })).toBeNull()
  })

  it('also for a pad that never answered HELLO', () => {
    notice({ status: 'connected', kind: 'serial', label: 'SnekPad', legacy: true })
    expect(screen.getByRole('alert').textContent).toContain('one flash from the computer')
  })
})

describe('FirmwareNotice: a build of Studio without a firmware bundle', () => {
  it('falls back to the plain "older than this app expects" warning, never offering an update', () => {
    notice(pad({ firmware: '0.1.0' }), null)
    expect(screen.getByRole('alert').textContent).toContain('older than this app expects')
    expect(screen.queryByRole('button', { name: 'Update pad' })).toBeNull()
  })

  it('shows nothing for a pad that is fine', () => {
    const { view } = notice(pad({ firmware: '0.3.4' }), null)
    expect(view.container.textContent).toBe('')
  })
})

describe('Settings: Pad firmware', () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- a test helper: its result is read by the tests next to it
  function menu(
    offer: ReturnType<typeof updateOffer>,
    padFirmware: string | undefined,
    bundleVersion: string | null = BUNDLE
  ) {
    installApi()
    const onUpdateFirmware = vi.fn()
    render(
      <SettingsMenu
        mock={false}
        onMock={() => {}}
        onReset={() => {}}
        sleepMinutes={2}
        onSleepMinutes={() => {}}
        connected
        sync="in-sync"
        pushing={false}
        onPush={() => {}}
        bundleVersion={bundleVersion}
        padFirmware={padFirmware}
        offer={offer}
        onUpdateFirmware={onUpdateFirmware}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }))
    return { onUpdateFirmware }
  }

  it('shows both versions and an Update button when the pad can take it', () => {
    const m = menu('ota', '0.3.4')
    expect(document.body.textContent).toContain(`On the pad: 0.3.4`)
    expect(document.body.textContent).toContain(`in this app: ${BUNDLE}`)
    fireEvent.click(screen.getByRole('button', { name: 'Update pad firmware…' }))
    expect(m.onUpdateFirmware).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText('Pad sleeps after')).toBeNull() // the menu closed so the dialog is in front
  })

  it('says an old pad needs one flash from the computer', () => {
    menu('manual', '0.3.3')
    expect(document.body.textContent).toContain('one flash from the computer')
    expect(screen.queryByRole('button', { name: 'Update pad firmware…' })).toBeNull()
  })

  it('says when the pad is up to date', () => {
    menu('none', BUNDLE)
    expect(document.body.textContent).toContain('latest firmware')
  })

  it('is not there at all when this build has no firmware bundle', () => {
    menu('none', '0.3.4', null)
    expect(document.body.textContent).not.toContain('Pad firmware')
  })
})
