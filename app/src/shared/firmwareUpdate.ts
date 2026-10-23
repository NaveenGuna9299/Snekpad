// Firmware update from Studio: the parts both processes share (the bundle, its manifest, the FW_* lines).
//
// A release carries the pad's firmware as a bundle: the compiled files plus manifest.json (made by
// Programs/build_mpy.py). Studio checks it, sends it to the pad over the data serial port, and the pad stages,
// verifies and installs it (Programs/fw_update.py, Programs/fw_boot.py). See PROTOCOL.md, "Firmware update".

import { z } from 'zod'
import { crc32Bytes } from './protocol'

/** The files an update may replace. Must match ALLOWED in Programs/fw_update.py (a test checks). */
export const FW_ALLOWED = [
  'firmware.mpy',
  'config_loader.mpy',
  'rgb_keys.mpy',
  'encoder_modes.mpy',
  'app_profiles.mpy',
  'oled_ui.mpy',
  'fw_update.mpy',
  'snekpad32.bmp'
] as const

// Limits the pad enforces (Programs/fw_update.py: MAX_FILES, MAX_FILE, MAX_TOTAL, SPACE_MARGIN, CONFIRM_S)
export const FW_MAX_FILES = 12
export const FW_MAX_FILE = 40000
export const FW_MAX_TOTAL = 150000
export const FW_SPACE_MARGIN = 16384
export const FW_CONFIRM_MS = 30000

/**
 * Bytes per FW_DATA line: 48 bytes are 64 characters of base64. The pad has only a few KB of free RAM while it
 * receives (and what is free is in small pieces), so a line is kept short, and Studio sends one line at a time and
 * waits for the pad (see FW_PACE below). With 96-byte lines sent back to back, a pad on firmware 0.4.0 read several
 * lines at once, ran out of memory on the second file and stopped answering.
 */
export const FW_CHUNK_BYTES = 48

const dotted = z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/)

export const manifestSchema = z
  .object({
    format: z.literal(1),
    version: dotted, // the firmware version in the bundle
    circuitpython: dotted, // the CircuitPython version the .mpy files were compiled for
    files: z
      .array(
        z.object({
          name: z.enum(FW_ALLOWED),
          size: z.number().int().min(1).max(FW_MAX_FILE),
          crc32: z.string().regex(/^[0-9a-f]{8}$/)
        })
      )
      .min(1)
      .max(FW_MAX_FILES)
  })
  .superRefine((m, ctx) => {
    if (new Set(m.files.map((f) => f.name)).size !== m.files.length)
      ctx.addIssue({ code: 'custom', message: 'a file is listed twice', path: ['files'] })
    if (m.files.reduce((n, f) => n + f.size, 0) > FW_MAX_TOTAL)
      ctx.addIssue({ code: 'custom', message: 'the update is too big', path: ['files'] })
  })
export type FirmwareManifest = z.infer<typeof manifestSchema>

/** A firmware update ready to send: the manifest and each file's bytes. */
export type FirmwareBundle = { manifest: FirmwareManifest; data: Record<string, Uint8Array> }

export const bundleBytes = (m: FirmwareManifest): number => m.files.reduce((n, f) => n + f.size, 0)

export const crcHexBytes = (bytes: Uint8Array): string =>
  crc32Bytes(bytes).toString(16).padStart(8, '0')

/** Why a bundle must not be sent (a missing, damaged or changed file), or null if it is whole. */
export function verifyBundle(b: FirmwareBundle): string | null {
  for (const f of b.manifest.files) {
    const data = b.data[f.name]
    if (!data) return `${f.name} is missing from the firmware bundle`
    if (data.length !== f.size) return `${f.name} has the wrong size`
    if (crcHexBytes(data) !== f.crc32) return `${f.name} is damaged`
  }
  return null
}

/** Where a firmware update is, for the progress dialog. `sent` and `total` count bytes of the whole update. */
export type FirmwareProgress =
  | { phase: 'checking' } // asking the pad about itself
  | { phase: 'waiting' } // the pad shows "press knob to allow"
  | { phase: 'sending'; file: string; sent: number; total: number }
  | { phase: 'finishing' } // committing; the pad restarts next

export type FirmwareUpdateResult = { ok: true } | { ok: false; error: string; cancelled?: boolean }

export type FwInfoResult = ({ ok: true } & FwInfo) | { ok: false; error: string }

// ---- the lines ---------------------------------------------------------------------------------

export const fwInfoLine = (): string => 'FW_INFO'
export const fwAbortLine = (): string => 'FW_ABORT'
export const fwFileEndLine = (): string => 'FW_FILE_END'
export const fwBeginLine = (m: FirmwareManifest): string =>
  `FW_BEGIN\t${m.version}\t${m.files.length}\t${bundleBytes(m)}\t${m.circuitpython}`
export const fwFileLine = (f: FirmwareManifest['files'][number]): string =>
  `FW_FILE\t${f.name}\t${f.size}\t${f.crc32}`
export const fwCommitLine = (version: string): string => `FW_COMMIT\t${version}`

/** The FW_DATA lines for one file, in order. */
export function fwDataLines(data: Uint8Array): string[] {
  const lines: string[] = []
  for (let i = 0; i < data.length; i += FW_CHUNK_BYTES)
    lines.push(`FW_DATA\t${Buffer.from(data.subarray(i, i + FW_CHUNK_BYTES)).toString('base64')}`)
  return lines
}

/** What the pad says about itself and its last update. `failed` is why the last update was undone, if it was. */
export type FwInfo = {
  firmware: string
  circuitpython: string
  freeBytes: number
  failed: string | null
}

/** `FW_INFO<TAB>firmware<TAB>circuitpython<TAB>free bytes<TAB>failed or -` */
export function parseFwInfo(line: string): FwInfo | null {
  const [tag, firmware, circuitpython, free, failed] = line.replace(/\r$/, '').split('\t')
  if (tag !== 'FW_INFO' || !dotted.safeParse(firmware).success) return null
  if (!dotted.safeParse(circuitpython).success) return null
  const freeBytes = Number(free)
  if (!Number.isInteger(freeBytes) || freeBytes < 0) return null
  return { firmware, circuitpython, freeBytes, failed: !failed || failed === '-' ? null : failed }
}
