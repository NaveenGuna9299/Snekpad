// Runs a firmware update and follows it until the result is known.
//
// Sending the files is the easy part (the main process does it and reports progress). What matters afterwards:
// the pad restarts, installs the update, and the new firmware has to prove itself. So this keeps watching the
// pad: it must come back on the new firmware and stay on it for a while. If it comes back on the OLD firmware
// the pad undid the update, and the pad says why (FW_INFO).

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeviceState } from '../../../shared/api'

export type UpdatePhase =
  | 'idle' // not started
  | 'checking' // asking the pad about itself
  | 'waiting' // the pad shows "press knob to allow"
  | 'sending'
  | 'finishing' // committing
  | 'restarting' // sent; the pad restarts and installs it
  | 'verifying' // back on the new firmware; making sure it stays up
  | 'done'
  | 'failed'
  | 'cancelled'

export type UpdateProgress = { file: string; sent: number; total: number }

export type FirmwareUpdate = {
  phase: UpdatePhase
  progress: UpdateProgress | null
  /** Why it failed, in words for the user. */
  error: string | null
  /** True once the pad was told to install: from here the old firmware may already be replaced. */
  committed: boolean
  start: () => void
  cancel: () => void
}

/** How long the pad gets to restart, install and come back before the update is called failed. */
export const RESTART_TIMEOUT_MS = 60_000
/** How long the new firmware must stay up (the pad itself keeps it after about 15 seconds). */
export const VERIFY_MS = 20_000

export function useFirmwareUpdate(device: DeviceState, bundleVersion: string): FirmwareUpdate {
  const [phase, setPhase] = useState<UpdatePhase>('idle')
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [committed, setCommitted] = useState(false)
  // true once the pad has been seen restarting: gone, or connected but not yet answering its greeting
  const sawRestart = useRef(false)
  // The pad reports why it undid an update only once, so ask it once: the pad's state changes several times in a
  // row as it reconnects, and a second answer (without the reason) must not replace the first.
  const askedWhy = useRef(false)

  const start = useCallback(() => {
    setError(null)
    setProgress(null)
    setCommitted(false)
    setPhase('checking')
    sawRestart.current = false
    askedWhy.current = false
    const off = window.api.onFirmwareProgress((p) => {
      if (p.phase === 'sending') {
        setPhase('sending')
        setProgress({ file: p.file, sent: p.sent, total: p.total })
      } else setPhase(p.phase)
    })
    window.api
      .updateFirmware()
      .then((r) => {
        off()
        if (r.ok) {
          setCommitted(true)
          setPhase('restarting')
        } else if (r.cancelled) {
          setPhase('cancelled')
        } else {
          setError(r.error)
          setPhase('failed')
        }
      })
      .catch((e: unknown) => {
        // the request itself failed (not the pad): stop waiting and say so
        off()
        setError(`The update could not be run: ${e instanceof Error ? e.message : String(e)}`)
        setPhase('failed')
      })
  }, [])

  const cancel = useCallback(() => {
    void window.api.cancelFirmwareUpdate()
  }, [])

  // Once sent, the pad restarts. "Verifying" is not stored: it is what 'restarting' looks like while the pad is
  // connected again and reports the new firmware.
  const newFirmwareUp = device.status === 'connected' && device.firmware === bundleVersion
  const shown: UpdatePhase = phase === 'restarting' && newFirmwareUp ? 'verifying' : phase

  // follow the pad through its restart
  useEffect(() => {
    if (phase !== 'restarting') return
    if (device.status !== 'connected') {
      sawRestart.current = true
      return
    }
    if (device.firmware === undefined && !device.legacy) {
      // Connected, but it has not said which firmware it runs. After an update that means it is restarting: the
      // pad restarts without disconnecting (the USB port stays open) and Studio then greets it again.
      sawRestart.current = true
      return
    }
    if (device.firmware === bundleVersion) return // the new firmware is up (verifying)
    if (!sawRestart.current) return // still the state from before the restart
    if (askedWhy.current) return
    askedWhy.current = true
    // It came back on another firmware: the pad undid the update. Ask it why.
    const shown = device.firmware ?? 'older than 0.3.3'
    void window.api.firmwareInfo().then((info) => {
      const why = info.ok && info.failed ? ` (${info.failed})` : ''
      setError(
        `The new firmware did not run properly, so the pad went back to its old firmware ${shown}${why}. Nothing is lost: the pad works as before.`
      )
      setPhase('failed')
    })
  }, [phase, device, bundleVersion])

  // the pad has to come back in time ...
  useEffect(() => {
    if (shown !== 'restarting') return
    const t = setTimeout(() => {
      // never advise unplugging: the pad may still be installing or undoing the update, and cutting the power
      // then can wipe its flash drive
      setError(
        'The pad did not come back after restarting. Wait another minute and keep it plugged in. If it still does not answer, close Studio and open it again.'
      )
      setPhase('failed')
    }, RESTART_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [shown])

  // ... and the new firmware has to stay up (the timer starts over if the pad goes away and comes back)
  useEffect(() => {
    if (shown !== 'verifying') return
    const t = setTimeout(() => setPhase('done'), VERIFY_MS)
    return () => clearTimeout(t)
  }, [shown])

  return { phase: shown, progress, error, committed, start, cancel }
}
