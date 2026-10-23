// Turns the sound the computer plays into the five small numbers the pad's music effects need.
//
// The renderer gives this the frequency picture of the last moment (what an AnalyserNode returns: one byte per
// frequency bin, 0 to 255, from 0 Hz up to half the sample rate), about 25 times a second. Out come the loudness of
// four bands from bass to treble, and a beat strength when the bass has just jumped. Each number is 0 to 63: that is
// what fits one character of the pad's serial line (see musicLine in protocol.ts).

export const BAND_COUNT = 4
export const LEVEL_MAX = 63

/** Where each band starts and ends, in Hz: bass, low middle, high middle, treble. */
export const BAND_EDGES_HZ: ReadonlyArray<readonly [number, number]> = [
  [40, 160],
  [160, 630],
  [630, 2500],
  [2500, 10000]
]

const SILENCE = 8 // a band mean (0 to 255) below this is no sound at all
const MIN_PEAK = 60 // the quietest peak a band is scaled against, so a whisper is not blown up to full
const PEAK_FALL = 0.995 // how much of its peak a band keeps from one call to the next (about 5 s to halve at 25 a second)
const CONTRAST = 1.6 // above 1 makes the quiet parts quieter and the loud parts stand out
const BEAT_MIN_BASS = 70 // the bass must be at least this loud to count as a beat
const BEAT_MIN_JUMP = 18 // and have risen this much above its recent average
const BEAT_GAP_MS = 200 // no two beats closer than this
const BEAT_AVERAGE = 0.9 // how much of the recent bass average is kept from one call to the next

export type MusicNumbers = { bands: [number, number, number, number]; beat: number }

export class MusicAnalyzer {
  private peaks: number[] = new Array<number>(BAND_COUNT).fill(MIN_PEAK)
  private bassAverage = 0
  private lastBeat = -Infinity

  /** `bins`: the frequency picture; `sampleRate`: of the audio that made it; `nowMs`: any clock in milliseconds. */
  process(bins: ArrayLike<number>, sampleRate: number, nowMs: number): MusicNumbers {
    const hzPerBin = sampleRate / 2 / bins.length
    const bands: number[] = []
    let bass = 0
    for (let b = 0; b < BAND_COUNT; b++) {
      const [lo, hi] = BAND_EDGES_HZ[b]
      // the bins from lo up to (not including) hi: a bin on the edge belongs to the band above it, never to two
      const first = Math.max(0, Math.ceil(lo / hzPerBin))
      const last = Math.min(bins.length, Math.max(first + 1, Math.ceil(hi / hzPerBin)))
      // the root of the mean of the squares: like a plain mean, but a strong narrow peak (one note, a hi-hat) counts
      // for more than it would spread thin over a wide band
      let sum = 0
      for (let i = first; i < last; i++) sum += bins[i] * bins[i]
      const mean = Math.sqrt(sum / (last - first))
      if (b === 0) bass = mean
      this.peaks[b] = Math.max(mean, this.peaks[b] * PEAK_FALL, MIN_PEAK)
      if (mean < SILENCE) {
        bands.push(0)
        continue
      }
      const level = Math.min(1, mean / this.peaks[b]) ** CONTRAST
      bands.push(Math.round(level * LEVEL_MAX))
    }

    // a beat: the bass jumps well above what it has been, and not too soon after the last one
    let beat = 0
    if (this.bassAverage === 0) this.bassAverage = bass // the first sound (or the first after silence) is not a jump
    const jump = bass - this.bassAverage
    if (bass >= BEAT_MIN_BASS && jump >= BEAT_MIN_JUMP && nowMs - this.lastBeat >= BEAT_GAP_MS) {
      beat = Math.max(20, Math.min(LEVEL_MAX, Math.round(20 + (jump / 60) * (LEVEL_MAX - 20))))
      this.lastBeat = nowMs
    }
    this.bassAverage = this.bassAverage * BEAT_AVERAGE + bass * (1 - BEAT_AVERAGE)

    return { bands: bands as [number, number, number, number], beat }
  }

  reset(): void {
    this.peaks.fill(MIN_PEAK)
    this.bassAverage = 0
    this.lastBeat = -Infinity
  }
}

/** True when there is nothing to show: every band silent and no beat. */
export const isSilent = (n: MusicNumbers): boolean => n.beat === 0 && n.bands.every((b) => b === 0)
