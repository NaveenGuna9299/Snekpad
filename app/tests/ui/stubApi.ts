// A stand-in for the preload bridge (`window.api`) so renderer components can run in jsdom.
// Everything not listed resolves to undefined, and `on*` subscriptions return a no-op unsubscribe.

import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { defaultConfig } from '../../src/shared/config'
import { DEFAULT_HUD } from '../../src/shared/hud'
import type { DeviceState, SnekApi } from '../../src/shared/api'
import type { KnobAction, PadInput } from '../../src/shared/protocol'
import type { FirmwareProgress } from '../../src/shared/firmwareUpdate'

// __DEV_TOOLS__ is a build-time constant in the app; here it is a global, on unless a test turns it off
beforeEach(() => {
  vi.stubGlobal('__DEV_TOOLS__', true)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

export type StubApi = {
  api: SnekApi
  /** Deliver a state change to everything subscribed with onDeviceState. */
  setDevice(state: DeviceState): void
  /** Deliver a key event to everything subscribed with onDeviceEvent. */
  emitKey(index: number, down: boolean): void
  /** Deliver a knob event to everything subscribed with onDeviceEvent. */
  emitKnob(action: KnobAction): void
  /** Deliver firmware update progress to everything subscribed with onFirmwareProgress. */
  emitProgress(p: FirmwareProgress): void
  /** How many onDeviceEvent subscriptions are active right now. */
  eventListeners(): number
  /** How many onFirmwareProgress subscriptions are active right now. */
  progressListeners(): number
}

export function installApi(
  device: DeviceState = { status: 'disconnected' },
  overrides: Partial<SnekApi> = {}
): StubApi {
  const stateCbs = new Set<(s: DeviceState) => void>()
  const eventCbs = new Set<(e: PadInput) => void>()
  const progressCbs = new Set<(p: FirmwareProgress) => void>()
  let current = device

  const known: Partial<SnekApi> = {
    loadConfig: () => Promise.resolve(defaultConfig()),
    loadBaseline: () => Promise.resolve(null),
    deviceState: () => Promise.resolve(current),
    pull: () => Promise.resolve({ ok: false, error: 'no pad' }),
    getStartup: () => Promise.resolve({ supported: false, enabled: false }),
    getTheme: () => Promise.resolve('system'),
    getAutoUpdateCheck: () => Promise.resolve(false),
    getHud: () => Promise.resolve({ ...DEFAULT_HUD }),
    setHud: () => Promise.resolve(),
    openReleasePage: vi.fn(() => Promise.resolve()),
    firmwareBundle: () => Promise.resolve({ ok: false, error: 'no bundle', missing: true }),
    onFirmwareProgress: (cb) => {
      progressCbs.add(cb)
      return () => progressCbs.delete(cb)
    },
    onDeviceState: (cb) => {
      stateCbs.add(cb)
      return () => stateCbs.delete(cb)
    },
    onDeviceEvent: (cb) => {
      eventCbs.add(cb)
      return () => eventCbs.delete(cb)
    },
    ...overrides
  }
  const api = new Proxy(known, {
    get(target, name: string) {
      if (name in target) return target[name as keyof SnekApi]
      if (name.startsWith('on')) return () => () => {}
      return () => Promise.resolve(undefined)
    }
  }) as SnekApi

  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true })
  return {
    api,
    setDevice(state) {
      current = state
      stateCbs.forEach((cb) => cb(state))
    },
    emitKey(index, down) {
      eventCbs.forEach((cb) => cb({ kind: 'key', index, down }))
    },
    emitKnob(action) {
      eventCbs.forEach((cb) => cb({ kind: 'knob', action }))
    },
    emitProgress(p) {
      progressCbs.forEach((cb) => cb(p))
    },
    progressListeners: () => progressCbs.size,
    eventListeners: () => eventCbs.size
  }
}
