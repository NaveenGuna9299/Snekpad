// Which pad firmware this app expects, and how to judge the version a pad reports in its HELLO reply.
//
// REQUIRED_FIRMWARE is bumped only when the app starts to rely on something a newer firmware added,
// not with every app release. The firmware's own number is FIRMWARE_VERSION in Programs/app_profiles.py;
// tests/firmware.test.ts checks that the firmware in this repo is at least REQUIRED_FIRMWARE.

import type { DeviceState } from './api'
import { isNewer } from './update'

export const REQUIRED_FIRMWARE = '0.3.3'

/** First firmware that draws the key LED effects (settings.effect) and reports the effect it runs. */
export const EFFECTS_FIRMWARE = '0.4.0'

/** First firmware with the Studio slot: the spare layer Studio fills with the profile of the app in focus (SLOT_*). */
export const SLOT_FIRMWARE = '0.5.0'

/** First firmware whose Studio slot takes extra layers and double-tap keys. */
export const LAYERS_FIRMWARE = '0.6.0'

/** True when the connected pad can run layers and double tap in a Studio-only profile. */
export const hasLayers = (device: DeviceState): boolean =>
  device.status === 'connected' && !!device.firmware && !isNewer(LAYERS_FIRMWARE, device.firmware)

/** True when the connected pad has the Studio slot (a pad that has not said its firmware yet does not count). */
export const hasSlot = (device: DeviceState): boolean =>
  device.status === 'connected' && !!device.firmware && !isNewer(SLOT_FIRMWARE, device.firmware)

/** First firmware that can receive an update from Studio (it has fw_update.py and fw_boot.py). */
export const OTA_FIRMWARE = '0.3.4'

/** `x.y.z`, digits only: the one shape the pad may send as its firmware version. */
export const isFirmwareVersion = (v: string): boolean => /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v)

export type FirmwareStatus =
  | 'none' // no pad connected
  | 'checking' // connected, the pad has not answered HELLO yet
  | 'ok'
  | 'older' // the pad's firmware is older than this app expects

export function firmwareStatus(device: DeviceState): FirmwareStatus {
  if (device.status !== 'connected') return 'none'
  if (device.firmware) return isNewer(REQUIRED_FIRMWARE, device.firmware) ? 'older' : 'ok'
  // Answered HELLO but sent no firmware version, or never answered it: both are firmware from before
  // versions were reported.
  if (device.events || device.legacy) return 'older'
  return 'checking'
}

/**
 * True when the connected pad was flashed with the development tools (flash_pad.ps1 -Dev). Only such a pad
 * can silence its keys during the key test and report the knob; a customer pad cannot, by design.
 */
export const hasDevTools = (device: DeviceState): boolean =>
  device.status === 'connected' && device.dev === true

/**
 * What to offer for the connected pad, given the firmware version inside this build of Studio (null = none):
 *  - 'ota'    the pad is older than the bundled firmware and can take the update from Studio
 *  - 'manual' it is older but too old to update itself: it needs one flash from the computer first
 *  - 'none'   nothing to offer (up to date, no pad, or this build has no bundle)
 */
export type UpdateOffer = 'none' | 'ota' | 'manual'

export function updateOffer(device: DeviceState, bundleVersion: string | null): UpdateOffer {
  if (!bundleVersion || device.status !== 'connected') return 'none'
  if (!device.firmware) return device.events || device.legacy ? 'manual' : 'none'
  if (!isNewer(bundleVersion, device.firmware)) return 'none'
  return isNewer(OTA_FIRMWARE, device.firmware) ? 'manual' : 'ota'
}

/** The sentence shown to the user when the status is `older`. */
export function firmwareNotice(device: DeviceState): string {
  const has = device.firmware ? `Pad firmware ${device.firmware}` : 'This pad’s firmware'
  return `${has} is older than this app expects (${REQUIRED_FIRMWARE}). Some features may not work until you update it.`
}
