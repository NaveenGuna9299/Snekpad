import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DeviceState } from '../src/shared/api'
import {
  OTA_FIRMWARE,
  REQUIRED_FIRMWARE,
  firmwareNotice,
  firmwareStatus,
  hasDevTools,
  isFirmwareVersion,
  updateOffer,
  OTA_NEW_FILES_FIRMWARE
} from '../src/shared/firmware'
import { isNewer } from '../src/shared/update'

const connected = (extra: Partial<DeviceState> = {}): DeviceState => ({
  status: 'connected',
  kind: 'serial',
  label: 'SnekPad',
  ...extra
})

describe('firmwareStatus', () => {
  it('has nothing to say without a pad', () => {
    expect(firmwareStatus({ status: 'disconnected' })).toBe('none')
    expect(firmwareStatus({ status: 'disconnected', firmware: '0.0.1' })).toBe('none')
  })

  it('waits for the pad to answer HELLO', () => {
    expect(firmwareStatus(connected())).toBe('checking')
  })

  it('accepts the required firmware and anything newer', () => {
    expect(firmwareStatus(connected({ events: true, firmware: REQUIRED_FIRMWARE }))).toBe('ok')
    expect(firmwareStatus(connected({ events: true, firmware: '99.0.0' }))).toBe('ok')
  })

  it('flags a firmware older than required', () => {
    expect(firmwareStatus(connected({ events: true, firmware: '0.1.0' }))).toBe('older')
    expect(firmwareStatus(connected({ events: true, firmware: '0.0.99' }))).toBe('older')
  })

  it('flags a pad that answers HELLO without a version (firmware from before versions)', () => {
    expect(firmwareStatus(connected({ events: true }))).toBe('older')
  })

  it('flags a pad that never answered HELLO', () => {
    expect(firmwareStatus(connected({ legacy: true }))).toBe('older')
  })
})

describe('firmwareNotice', () => {
  it('names the version when the pad reported one', () => {
    expect(firmwareNotice(connected({ events: true, firmware: '0.1.0' }))).toContain('0.1.0')
  })

  it('still reads well without a version', () => {
    const text = firmwareNotice(connected({ events: true }))
    expect(text).toContain(REQUIRED_FIRMWARE)
    expect(text).not.toContain('undefined')
  })
})

describe('hasDevTools', () => {
  it('is true only for a connected pad that says it is a development flash', () => {
    expect(hasDevTools(connected({ events: true, firmware: REQUIRED_FIRMWARE, dev: true }))).toBe(
      true
    )
  })

  it('is false for a customer pad, however new its firmware', () => {
    expect(hasDevTools(connected({ events: true, firmware: '99.0.0' }))).toBe(false)
    expect(hasDevTools(connected({ events: true, firmware: '99.0.0', dev: false }))).toBe(false)
    expect(hasDevTools(connected())).toBe(false)
  })

  it('is false without a pad', () => {
    expect(hasDevTools({ status: 'disconnected', dev: true })).toBe(false)
  })
})

describe('updateOffer', () => {
  it('offers the update to a pad that can take it and is older than the bundle', () => {
    expect(updateOffer(connected({ events: true, firmware: OTA_FIRMWARE }), '0.5.9')).toBe('ota')
    expect(updateOffer(connected({ events: true, firmware: '0.9.9' }), '1.0.0')).toBe('ota')
    expect(
      updateOffer(connected({ events: true, firmware: OTA_NEW_FILES_FIRMWARE }), '0.6.1')
    ).toBe('ota')
  })

  it('sends a pad older than 0.6.0 to a flash from the computer: the bundle carries files it would refuse', () => {
    expect(updateOffer(connected({ events: true, firmware: '0.5.1' }), '0.6.0')).toBe('manual')
    expect(updateOffer(connected({ events: true, firmware: '0.5.9' }), '1.0.0')).toBe('manual')
    // a bundle from before the new files can still be sent to a pad that old (it holds none of them)
    expect(updateOffer(connected({ events: true, firmware: '0.5.0' }), '0.5.1')).toBe('ota')
  })

  it('offers nothing when the pad has the bundled firmware or newer', () => {
    expect(updateOffer(connected({ events: true, firmware: '1.0.0' }), '1.0.0')).toBe('none')
    expect(updateOffer(connected({ events: true, firmware: '2.0.0' }), '1.0.0')).toBe('none')
  })

  it('says a pad too old to update itself needs one flash from the computer', () => {
    expect(updateOffer(connected({ events: true, firmware: '0.3.3' }), '9.0.0')).toBe('manual')
    expect(updateOffer(connected({ events: true }), '9.0.0')).toBe('manual') // answers HELLO, sends no version
    expect(updateOffer(connected({ legacy: true }), '9.0.0')).toBe('manual') // never answered HELLO
  })

  it('offers nothing without a pad, without a bundle, or before the pad has answered', () => {
    expect(updateOffer({ status: 'disconnected' }, '9.0.0')).toBe('none')
    expect(updateOffer(connected({ events: true, firmware: '0.3.4' }), null)).toBe('none')
    expect(updateOffer(connected(), '9.0.0')).toBe('none')
  })

  it('a pad exactly at the first updatable firmware can take an update', () => {
    expect(updateOffer(connected({ events: true, firmware: OTA_FIRMWARE }), '0.3.5')).toBe('ota')
    expect(isNewer(OTA_FIRMWARE, '0.3.3')).toBe(true)
  })
})

describe('isFirmwareVersion', () => {
  it('accepts x.y.z only', () => {
    expect(isFirmwareVersion('0.3.3')).toBe(true)
    expect(isFirmwareVersion('10.20.30')).toBe(true)
    for (const bad of ['', '1', '1.2', '1.2.3.4', 'v1.2.3', '1.2.x', '1.2.3-rc1', ' 1.2.3'])
      expect(isFirmwareVersion(bad)).toBe(false)
  })
})

describe('the firmware in this repo', () => {
  const programs = join(__dirname, '..', '..', 'Programs')
  const source = readFileSync(join(programs, 'app_profiles.py'), 'utf8')
  const version = /^FIRMWARE_VERSION = "([^"]+)"/m.exec(source)?.[1]

  it('declares a valid FIRMWARE_VERSION', () => {
    expect(version).toBeDefined()
    expect(isFirmwareVersion(version!)).toBe(true)
  })

  it('is at least the firmware the app requires', () => {
    expect(isNewer(REQUIRED_FIRMWARE, version!)).toBe(false)
  })

  it('is at least the first firmware that can update itself, and has the updater', () => {
    expect(isNewer(OTA_FIRMWARE, version!)).toBe(false)
    expect(existsSync(join(programs, 'fw_update.py'))).toBe(true)
    expect(existsSync(join(programs, 'fw_boot.py'))).toBe(true)
  })

  it('sends the version in its HELLO reply', () => {
    expect(source).toContain(String.raw`"HELLO\t%d\t%s" % (PROTOCOL_VERSION, FIRMWARE_VERSION)`)
  })
})

describe('the development tools are kept out of the customer firmware', () => {
  const programs = join(__dirname, '..', '..', 'Programs')
  const read = (...p: string[]): string => readFileSync(join(programs, ...p), 'utf8')

  it('lives in its own file, outside the files that go on a customer pad', () => {
    expect(existsSync(join(programs, 'dev', 'dev_tools.py'))).toBe(true)
    expect(existsSync(join(programs, 'dev_tools.py'))).toBe(false)
  })

  it('has the TEST command and the knob events, and the customer files do not', () => {
    const dev = read('dev', 'dev_tools.py')
    expect(dev).toContain('b"TEST"')
    expect(dev).toContain('def report_knob')
    for (const file of ['app_profiles.py', 'encoder_modes.py', 'code.py']) {
      const text = read(file)
      expect(text, file).not.toContain('"TEST"')
      expect(text, file).not.toContain('report_knob')
    }
  })

  it('is flagged in HELLO by the dev file only', () => {
    expect(read('dev', 'dev_tools.py')).toContain(String.raw`+ "\tdev"`)
    expect(read('app_profiles.py')).not.toContain(String.raw`"\tdev"`)
  })
})
