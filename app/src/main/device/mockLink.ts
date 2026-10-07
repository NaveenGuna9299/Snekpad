// A fake pad so the whole app works without hardware (and for tests).
// It answers the protocol the way the firmware does.

import { ConfigReceiver, configFrames, liveViewOf, PROTOCOL_VERSION } from '../../shared/protocol'
import type { Link } from './link'

export class MockLink implements Link {
  readonly kind = 'mock' as const
  readonly label = 'Mock pad'
  readonly log: string[] = [] // every line the app sent, for tests and debugging
  config = ''

  private lineCb: (line: string) => void = () => {}
  private closeCb: (reason?: string) => void = () => {}
  private rx = new ConfigReceiver()

  write(line: string): void {
    this.log.push(line)
    const cmd = line.split('\t')[0]
    let reply: string | null = null
    if (cmd === 'GET_CFG') {
      const frames = this.config
        ? configFrames(JSON.stringify(liveViewOf(JSON.parse(this.config))))
        : ['ERR\tno config on pad']
      frames.forEach((f, i) => setTimeout(() => this.lineCb(f), 5 + i))
      return
    }
    if (cmd === 'PING') reply = 'PONG'
    else if (cmd === 'HELLO') reply = `HELLO\t${PROTOCOL_VERSION}`
    else if (cmd === 'LED') reply = 'OK'
    else if (cmd.startsWith('CFG_')) {
      reply = this.rx.handle(line)
      if (cmd === 'CFG_END' && reply === 'OK') this.config = this.rx.received
    }
    if (reply) setTimeout(() => this.lineCb(reply), 5)
  }

  /** Pretend the pad sent this line on its own (for tests and the mock pad). */
  emit(line: string): void {
    this.lineCb(line)
  }

  onLine(cb: (line: string) => void): void {
    this.lineCb = cb
  }

  onClose(cb: (reason?: string) => void): void {
    this.closeCb = cb
  }

  close(): void {
    this.closeCb()
  }
}
