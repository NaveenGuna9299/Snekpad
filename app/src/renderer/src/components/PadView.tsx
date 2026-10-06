import { COLS, ROWS, type Profile } from '../../../shared/config'

export type Selection = { kind: 'key'; index: number } | { kind: 'encoder' }

type Props = {
  profile: Profile
  oledHeight: 32 | 64
  selection: Selection
  onSelect: (s: Selection) => void
}

const KEY = 78
const GAP = 12
const PAD = 24
const GRID_W = COLS * KEY + (COLS - 1) * GAP
const TOP_H = 96
const W = GRID_W + PAD * 2
const H = PAD + TOP_H + GAP + ROWS * KEY + (ROWS - 1) * GAP + PAD

/** The pad drawn as SVG: OLED + encoder on top, 4 x 3 keys below. Key colour = its RGB colour. */
export function PadView({ profile, oledHeight, selection, onSelect }: Props): React.JSX.Element {
  const gridTop = PAD + TOP_H + GAP
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[460px]" role="group" aria-label="SnekPad">
      <rect x="2" y="2" width={W - 4} height={H - 4} rx="18" fill="var(--surface)" stroke="var(--line)" strokeWidth="2" />

      <Oled profile={profile} x={PAD} y={PAD} w={GRID_W - 96} h={TOP_H} height={oledHeight} />

      <g
        role="button"
        tabIndex={0}
        aria-label="Rotary encoder"
        aria-pressed={selection.kind === 'encoder'}
        className="cursor-pointer"
        onClick={() => onSelect({ kind: 'encoder' })}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect({ kind: 'encoder' })}
      >
        <circle
          cx={PAD + GRID_W - 40}
          cy={PAD + TOP_H / 2}
          r="38"
          fill="var(--surface-2)"
          stroke={selection.kind === 'encoder' ? 'var(--accent)' : 'var(--line)'}
          strokeWidth={selection.kind === 'encoder' ? 4 : 2}
        />
        <circle cx={PAD + GRID_W - 40} cy={PAD + TOP_H / 2} r="24" fill="var(--bg)" stroke="var(--line)" />
        <line x1={PAD + GRID_W - 40} y1={PAD + TOP_H / 2 - 22} x2={PAD + GRID_W - 40} y2={PAD + TOP_H / 2 - 10} stroke="var(--muted)" strokeWidth="3" strokeLinecap="round" />
      </g>

      {profile.keys.map((k, i) => {
        const col = i % COLS
        const row = Math.floor(i / COLS)
        const x = PAD + col * (KEY + GAP)
        const y = gridTop + row * (KEY + GAP)
        const selected = selection.kind === 'key' && selection.index === i
        const light = luminance(k.color) > 0.55
        return (
          <g
            key={i}
            role="button"
            tabIndex={0}
            aria-label={`Key ${i + 1}: ${k.label || 'empty'}`}
            aria-pressed={selected}
            className="cursor-pointer"
            onClick={() => onSelect({ kind: 'key', index: i })}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect({ kind: 'key', index: i })}
          >
            <rect x={x} y={y} width={KEY} height={KEY} rx="10" fill="var(--surface-2)" stroke={selected ? 'var(--accent)' : 'var(--line)'} strokeWidth={selected ? 4 : 2} />
            <rect x={x + 8} y={y + 8} width={KEY - 16} height={KEY - 16} rx="6" fill={k.color} opacity={k.color.toLowerCase() === '#000000' ? 0.15 : 0.92} />
            <text x={x + KEY / 2} y={y + KEY / 2 + 5} textAnchor="middle" fontSize="15" fontFamily="Consolas, monospace" fontWeight="600" fill={light ? '#111' : '#fff'}>
              {k.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function Oled({ profile, x, y, w, h, height }: { profile: Profile; x: number; y: number; w: number; h: number; height: 32 | 64 }): React.JSX.Element {
  // 128 px wide; text is 6 px per character, so a 4-column legend cell is 32 px (5 chars)
  const scale = (w - 12) / 128
  const ox = x + 6
  const oy = y + (h - 32 * scale) / 2
  const cell = 32 * scale
  const line = 8 * scale
  return (
    <g aria-label="OLED preview">
      <rect x={x} y={y} width={w} height={h} rx="6" fill="var(--oled-bg)" stroke="var(--line)" strokeWidth="2" />
      <g fontFamily="Consolas, monospace" fontSize={7.4 * scale} fill="var(--oled-fg)">
        <text x={ox + 2} y={oy + line - 1}>{profile.name}</text>
        <text x={ox + 128 * scale - 2} y={oy + line - 1} textAnchor="end">{profile.encoder.label}</text>
        {profile.keys.map((k, i) => (
          <text key={i} x={ox + (i % COLS) * cell + cell / 2} y={oy + line * (2 + Math.floor(i / COLS)) - 1} textAnchor="middle">
            {k.label}
          </text>
        ))}
      </g>
      {height === 64 && <text x={x + w - 6} y={y + h - 4} textAnchor="end" fontSize="8" fill="var(--muted)">128×64</text>}
    </g>
  )
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
