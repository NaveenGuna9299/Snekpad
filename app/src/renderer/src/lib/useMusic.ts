import { useEffect, useState } from 'react'
import { MusicAnalyzer, isSilent, BAND_COUNT } from '../../../shared/music'

export type MusicStatus = 'off' | 'starting' | 'listening' | 'error'
export type MusicState = {
  status: MusicStatus
  /** Why listening failed, when status is 'error'. */
  error?: string
  /** What the pad is being sent right now: four bands (0 to 63) and a beat (0 = none). Updated about 10 times a second. */
  bands: number[]
  beat: number
}

const SEND_EVERY_MS = 40 // 25 a second: the pad smooths what it gets into 40 frames a second
const SHOW_EVERY_MS = 100 // the on-screen meter does not need more
const FFT_SIZE = 1024

const OFF: MusicState = { status: 'off', bands: new Array<number>(BAND_COUNT).fill(0), beat: 0 }

/**
 * Listens to the sound the computer plays while `enabled`, and sends the pad its levels. Stops (and lets go of the
 * sound) when `enabled` turns off. Needs Windows: the main process answers getDisplayMedia with system audio loopback.
 */
export function useMusic(enabled: boolean): MusicState {
  const [state, setState] = useState<MusicState>(OFF)

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    let timer: ReturnType<typeof setInterval> | null = null

    const start = async (): Promise<void> => {
      setState({ ...OFF, status: 'starting' })
      try {
        // the window asks for the screen; the main process hands over a screen with the system sound
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        for (const t of stream.getVideoTracks()) t.stop() // the picture is not needed, only the sound
        if (stream.getAudioTracks().length === 0) {
          throw new Error("Studio could not get the computer's sound. Listening needs Windows.")
        }
        if (stopped) return
        context = new AudioContext()
        const analyser = context.createAnalyser()
        analyser.fftSize = FFT_SIZE
        analyser.smoothingTimeConstant = 0.5
        context.createMediaStreamSource(stream).connect(analyser) // not connected on to the speakers
        const bins = new Uint8Array(analyser.frequencyBinCount)
        const analyzer = new MusicAnalyzer()
        let wasSilent = true
        let lastShown = 0
        setState({ ...OFF, status: 'listening' })

        timer = setInterval(() => {
          analyser.getByteFrequencyData(bins)
          const now = performance.now()
          const n = analyzer.process(bins, context!.sampleRate, now)
          const silent = isSilent(n)
          // a quiet moment is sent once (so the lights go out), then nothing until there is sound again
          if (!silent || !wasSilent) window.api.sendMusic(n.bands, n.beat)
          wasSilent = silent
          if (now - lastShown >= SHOW_EVERY_MS) {
            lastShown = now
            setState({ status: 'listening', bands: n.bands, beat: n.beat })
          }
        }, SEND_EVERY_MS)
      } catch (e) {
        if (stopped) return
        const message = e instanceof Error ? e.message : String(e)
        setState({ ...OFF, status: 'error', error: message })
      }
    }
    void start()

    return () => {
      stopped = true
      if (timer) clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
      void context?.close().catch(() => {})
    }
  }, [enabled])

  return enabled ? state : OFF // turned off: nothing is heard, whatever the last state was
}
