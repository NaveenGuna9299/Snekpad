// Real pad over USB serial. The pad has two CDC ports: the CircuitPython console and the
// "data" port from boot.py. We try every CircuitPython port and keep the one that answers
// PING with PONG (same method as focus_sender.py).

import { SerialPort } from 'serialport'
import type { Link } from './link'

const CIRCUITPY_VIDS = ['239a', '2e8a', '303a'] // Adafruit, Raspberry Pi, Espressif
const BAUD = 115200

class SerialLink implements Link {
  readonly kind = 'serial' as const
  private buf = ''
  private lineCb: (line: string) => void = () => {}
  private closeCb: (reason?: string) => void = () => {}

  constructor(
    private port: SerialPort,
    readonly label: string
  ) {
    port.on('data', (d: Buffer) => {
      this.buf += d.toString('utf8')
      let i: number
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, '')
        this.buf = this.buf.slice(i + 1)
        if (line) this.lineCb(line)
      }
      if (this.buf.length > 4096) this.buf = ''
    })
    port.on('close', () => this.closeCb('device unplugged'))
    port.on('error', (e) => this.closeCb(e.message))
  }

  write(line: string): void {
    this.port.write(line + '\n')
  }

  onLine(cb: (line: string) => void): void {
    this.lineCb = cb
  }

  onClose(cb: (reason?: string) => void): void {
    this.closeCb = cb
  }

  close(): void {
    if (this.port.isOpen) this.port.close()
  }
}

function open(path: string): Promise<SerialPort> {
  return new Promise((resolve, reject) => {
    const p = new SerialPort({ path, baudRate: BAUD, autoOpen: false })
    p.open((err) => (err ? reject(err) : resolve(p)))
  })
}

/** True if this port answers PING with PONG within 1 s. */
function probe(port: SerialPort): Promise<boolean> {
  return new Promise((resolve) => {
    let got = ''
    const done = (ok: boolean): void => {
      clearTimeout(timer)
      port.off('data', onData)
      resolve(ok)
    }
    const onData = (d: Buffer): void => {
      got += d.toString('utf8')
      if (got.includes('PONG')) done(true)
    }
    const timer = setTimeout(() => done(false), 1000)
    port.on('data', onData)
    port.write('PING\n')
  })
}

/** Returns a Link to the pad's data port, or null if no pad is plugged in / reachable. */
export async function findPad(): Promise<Link | null> {
  const ports = await SerialPort.list()
  for (const info of ports) {
    const vid = (info.vendorId ?? '').toLowerCase()
    if (!CIRCUITPY_VIDS.includes(vid)) continue
    let port: SerialPort
    try {
      port = await open(info.path)
    } catch {
      continue // busy (open in another program), skip
    }
    if (await probe(port)) return new SerialLink(port, info.path)
    if (port.isOpen) port.close()
  }
  return null
}
