// A Link is one open connection to a pad (real USB serial, or the mock).
// The DeviceManager only talks to this interface.

export interface Link {
  readonly kind: 'serial' | 'mock'
  readonly label: string // e.g. "COM5" or "Mock pad"
  write(line: string): void
  onLine(cb: (line: string) => void): void
  onClose(cb: (reason?: string) => void): void
  close(): void
}
