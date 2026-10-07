// The editor's document and device state, in one place (App.tsx only lays out the screen).
//
//   config    the document being edited (with undo / redo), auto-saved locally after a short pause
//   baseline  what the pad is known to hold; the difference to `config` is "not sent yet"
//   device    connection state pushed from the main process
//
// The pad's live view is only adopted when it would not overwrite unsent edits (see canAdoptLiveView).

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Config } from '../../../shared/config'
import type { DeviceState } from '../../../shared/api'
import { applyLiveView } from '../../../shared/protocol'
import { canAdoptLiveView, sameConfig, syncStatus, type SyncStatus } from '../../../shared/sync'
import { useHistory, type History } from './useHistory'

const SAVE_DELAY_MS = 400
const MESSAGE_MS = 5000
export const UNDO_MESSAGE_MS = 8000

export type Message = { text: string; error: boolean; undoable?: boolean }

export type Studio = {
  config: Config | null
  update: (fn: (c: Config) => Config) => void
  history: History<Config>
  device: DeviceState
  connected: boolean
  sync: SyncStatus
  push: () => Promise<void>
  pushing: boolean
  message: Message | null
  dismiss: () => void
  flash: (text: string, error?: boolean, undoable?: boolean) => void
}

export function useStudio(): Studio {
  const history = useHistory<Config>(null)
  const config = history.value
  const [baseline, setBaseline] = useState<Config | null>(null)
  const [device, setDevice] = useState<DeviceState>({ status: 'disconnected' })
  const [pushing, setPushing] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)
  const messageTimer = useRef<number | undefined>(undefined)

  // refs let async callbacks (pull, push) see the latest state when they finish
  const latest = useRef({ config, baseline })
  useEffect(() => {
    latest.current = { config, baseline }
  })

  const { replace, set } = history

  useEffect(() => {
    void Promise.all([window.api.loadConfig(), window.api.loadBaseline()]).then(([c, b]) => {
      setBaseline(b)
      replace(c)
    })
    void window.api.deviceState().then(setDevice)
    return window.api.onDeviceState(setDevice)
  }, [replace])

  // when a pad connects, show what is live on it, unless that would overwrite unsent edits
  const connected = device.status === 'connected'
  const loaded = config !== null
  useEffect(() => {
    if (!connected || !loaded) return
    let cancelled = false
    void window.api.pull().then((r) => {
      const { config: now, baseline: known } = latest.current
      if (cancelled || !r.ok || !now || !canAdoptLiveView(now, known)) return
      const adopted = applyLiveView(now, r.view)
      if (!sameConfig(adopted, now)) replace(adopted)
      setBaseline(adopted)
      void window.api.saveBaseline(adopted)
    })
    return () => {
      cancelled = true
    }
  }, [connected, loaded, device.label, replace])

  // auto-save edits locally after a short pause, and once more when the window goes away
  const saveTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!config) return
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void window.api.saveConfig(config), SAVE_DELAY_MS)
    const flush = (): void => {
      window.clearTimeout(saveTimer.current)
      void window.api.saveConfig(config)
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [config])

  const update = useCallback(
    (fn: (c: Config) => Config) => {
      const c = latest.current.config
      if (c) set(fn(c))
    },
    [set]
  )

  const flash = useCallback((text: string, error = false, undoable = false) => {
    window.clearTimeout(messageTimer.current)
    setMessage({ text, error, undoable })
    messageTimer.current = window.setTimeout(() => setMessage(null), undoable ? UNDO_MESSAGE_MS : MESSAGE_MS)
  }, [])

  const push = useCallback(async () => {
    const sent = latest.current.config
    if (!sent) return
    setPushing(true)
    const r = await window.api.push(sent)
    setPushing(false)
    if (r.ok) setBaseline(sent)
    flash(r.ok ? 'Sent to the pad.' : `Could not send: ${r.error}`, !r.ok)
  }, [flash])

  const sync: SyncStatus = syncStatus(connected, pushing, config, baseline)

  const dismiss = useCallback(() => setMessage(null), [])

  return { config, update, history, device, connected, sync, push, pushing, message, flash, dismiss }
}
