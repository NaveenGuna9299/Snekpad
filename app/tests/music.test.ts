import { describe, expect, it } from 'vitest'
import { BAND_COUNT, BAND_EDGES_HZ, LEVEL_MAX, MusicAnalyzer, isSilent } from '../src/shared/music'
import { musicLine } from '../src/shared/protocol'

const RATE = 48000
const BINS = 512 // what an analyser with fftSize 1024 gives
const HZ_PER_BIN = RATE / 2 / BINS

/** A frequency picture with `level` (0 to 255) in the bins of the given bands and 0 everywhere else. */
function picture(levels: number[]): Uint8Array {
  const bins = new Uint8Array(BINS)
  levels.forEach((level, band) => {
    const [lo, hi] = BAND_EDGES_HZ[band]
    for (let i = Math.ceil(lo / HZ_PER_BIN); i < Math.ceil(hi / HZ_PER_BIN); i++) bins[i] = level
  })
  return bins
}

describe('MusicAnalyzer', () => {
  it('has four bands that go from bass to treble without overlapping', () => {
    expect(BAND_EDGES_HZ).toHaveLength(BAND_COUNT)
    for (let b = 1; b < BAND_COUNT; b++)
      expect(BAND_EDGES_HZ[b][0]).toBeGreaterThanOrEqual(BAND_EDGES_HZ[b - 1][1])
  })

  it('says silence for no sound', () => {
    const a = new MusicAnalyzer()
    const n = a.process(new Uint8Array(BINS), RATE, 0)
    expect(n.bands).toEqual([0, 0, 0, 0])
    expect(n.beat).toBe(0)
    expect(isSilent(n)).toBe(true)
  })

  it('puts the sound in the band it is in and nowhere else', () => {
    for (let band = 0; band < BAND_COUNT; band++) {
      const levels = [0, 0, 0, 0]
      levels[band] = 200
      const n = new MusicAnalyzer().process(picture(levels), RATE, 0)
      n.bands.forEach((value, i) =>
        i === band ? expect(value).toBeGreaterThan(40) : expect(value).toBe(0)
      )
    }
  })

  it('keeps every number between 0 and 63', () => {
    const a = new MusicAnalyzer()
    for (let t = 0; t < 200; t++) {
      const n = a.process(picture([255, 255, 255, 255]), RATE, t * 40)
      for (const v of [...n.bands, n.beat]) {
        expect(Number.isInteger(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(LEVEL_MAX)
      }
    }
  })

  it('shows louder sound as a higher number', () => {
    const a = new MusicAnalyzer()
    const loud = a.process(picture([240, 0, 0, 0]), RATE, 0).bands[0]
    expect(loud).toBe(LEVEL_MAX) // the loudest it has heard
    const softer = a.process(picture([150, 0, 0, 0]), RATE, 40).bands[0]
    const softest = a.process(picture([80, 0, 0, 0]), RATE, 80).bands[0]
    expect(softer).toBeLessThan(loud)
    expect(softest).toBeLessThan(softer)
  })

  it('does not blow a very quiet sound up to full', () => {
    const n = new MusicAnalyzer().process(picture([20, 0, 0, 0]), RATE, 0)
    expect(n.bands[0]).toBeLessThan(20)
  })

  it('adjusts to the volume: the same music at half the volume still reaches near the top after a while', () => {
    const a = new MusicAnalyzer()
    for (let t = 0; t < 40; t++) a.process(picture([240, 0, 0, 0]), RATE, t * 40) // loud for a second
    let last = 0
    for (let t = 40; t < 1000; t++) last = a.process(picture([120, 0, 0, 0]), RATE, t * 40).bands[0] // then half as loud
    expect(last).toBeGreaterThan(40)
  })

  it('finds a beat when the bass jumps, and not before', () => {
    const a = new MusicAnalyzer()
    let beats = 0
    for (let t = 0; t < 10; t++)
      beats += a.process(picture([90, 0, 0, 0]), RATE, t * 40).beat > 0 ? 1 : 0
    expect(beats).toBe(0) // steady bass is not a beat
    const hit = a.process(picture([230, 0, 0, 0]), RATE, 400)
    expect(hit.beat).toBeGreaterThanOrEqual(20)
    expect(hit.beat).toBeLessThanOrEqual(LEVEL_MAX)
  })

  it('does not find two beats within 200 ms, but does find the next one after that', () => {
    const a = new MusicAnalyzer()
    for (let t = 0; t < 10; t++) a.process(picture([60, 0, 0, 0]), RATE, t * 40)
    expect(a.process(picture([230, 0, 0, 0]), RATE, 400).beat).toBeGreaterThan(0)
    a.process(picture([60, 0, 0, 0]), RATE, 440)
    expect(a.process(picture([230, 0, 0, 0]), RATE, 480).beat).toBe(0) // 80 ms later
    for (let t = 0; t < 6; t++) a.process(picture([60, 0, 0, 0]), RATE, 520 + t * 40)
    expect(a.process(picture([230, 0, 0, 0]), RATE, 800).beat).toBeGreaterThan(0)
  })

  it('hears one strong note in a wide band, such as a single high tone', () => {
    const bins = new Uint8Array(BINS)
    bins[Math.round(3000 / HZ_PER_BIN)] = 230 // one bin, in the treble band
    const n = new MusicAnalyzer().process(bins, RATE, 0)
    expect(n.bands[3]).toBeGreaterThan(0)
    expect(n.bands.slice(0, 3)).toEqual([0, 0, 0])
  })

  it('does not count quiet bass as a beat', () => {
    const a = new MusicAnalyzer()
    a.process(picture([0, 0, 0, 0]), RATE, 0)
    expect(a.process(picture([50, 0, 0, 0]), RATE, 400).beat).toBe(0)
  })

  it('works with another sample rate and another number of bins', () => {
    const bins = new Uint8Array(1024)
    const hz = 44100 / 2 / 1024
    for (let i = Math.ceil(40 / hz); i < Math.ceil(160 / hz); i++) bins[i] = 220
    const n = new MusicAnalyzer().process(bins, 44100, 0)
    expect(n.bands[0]).toBeGreaterThan(40)
    expect(n.bands.slice(1)).toEqual([0, 0, 0])
  })

  it('starts again from scratch after reset', () => {
    const a = new MusicAnalyzer()
    for (let t = 0; t < 10; t++) a.process(picture([240, 240, 240, 240]), RATE, t * 40)
    a.reset()
    const n = a.process(picture([30, 0, 0, 0]), RATE, 0)
    expect(n.bands[0]).toBeLessThan(25) // against the quietest peak, not the loud one from before the reset
  })
})

describe('musicLine', () => {
  it('is M and five characters: 48 plus each number', () => {
    expect(musicLine([0, 1, 62, 63], 5)).toBe('M01no5')
    const line = musicLine([0, 10, 20, 63], 0)
    expect(line.length).toBe(6)
    expect(line[0]).toBe('M')
    expect([...line.slice(1)].map((c) => c.charCodeAt(0) - 48)).toEqual([0, 10, 20, 63, 0])
  })

  it('keeps every number in range and whole', () => {
    const line = musicLine([-5, 200, 12.6, NaN], 99)
    expect([...line.slice(1)].map((c) => c.charCodeAt(0) - 48)).toEqual([0, 63, 13, 0, 63])
  })

  it('fills in a missing band with 0', () => {
    expect([...musicLine([7], 0).slice(1)].map((c) => c.charCodeAt(0) - 48)).toEqual([
      7, 0, 0, 0, 0
    ])
  })

  it('never contains a tab, a newline or a space, so the pad reads it as one line of bytes', () => {
    for (let n = 0; n <= 63; n++) {
      const line = musicLine([n, n, n, n], n)
      expect(line).not.toMatch(/[\t\r\n ]/)
      expect([...line].every((c) => c.charCodeAt(0) < 127)).toBe(true)
    }
  })
})
