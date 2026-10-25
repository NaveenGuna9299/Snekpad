// The HUD: a small see-through panel over other apps that shows the keys of the profile the pad is on.
// Shared by the main process (the overlay window, the tray) and the renderer (settings).
import { z } from 'zod'

export const hudModeSchema = z.enum(['off', 'flash', 'pinned'])
export type HudMode = z.infer<typeof hudModeSchema>

export const hudCornerSchema = z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right'])
export type HudCorner = z.infer<typeof hudCornerSchema>

export const hudSizeSchema = z.enum(['compact', 'slim', 'comfy'])
export type HudSize = z.infer<typeof hudSizeSchema>

export const MIN_HUD_OPACITY = 0.2 // below this the keys are too faint to read over a busy app

const fields = {
  /** off; flash = shown for a few seconds when the pad changes profile; pinned = always shown */
  mode: hudModeSchema,
  /** the corner it snaps to (slim is centred along the top or the bottom edge instead) */
  corner: hudCornerSchema,
  /** compact = labels only; slim = one row of keys; comfy = labels and shortcuts */
  size: hudSizeSchema,
  /** how solid the panel is, MIN_HUD_OPACITY to 1 (the keys and text stay solid) */
  opacity: z.number().min(MIN_HUD_OPACITY).max(1),
  /** where the user dragged it (top-left of the panel, in screen pixels); null = use the corner */
  pos: z.object({ x: z.number().int(), y: z.number().int() }).nullable()
}

/** A change to the HUD settings: any of them, and nothing else. Used for what the windows send, so a bad value is refused. */
export const hudPatchSchema = z.object(fields).partial().strict()

/** The saved settings: a missing or damaged value falls back to its default, so older files keep working. */
export const hudPrefSchema = z.object({
  mode: fields.mode.catch('flash'),
  corner: fields.corner.catch('bottom-right'),
  size: fields.size.catch('comfy'),
  opacity: fields.opacity.catch(0.9),
  pos: fields.pos.catch(null)
})
export type HudPref = z.infer<typeof hudPrefSchema>

export const DEFAULT_HUD: HudPref = {
  mode: 'flash',
  corner: 'bottom-right',
  size: 'comfy',
  opacity: 0.9,
  pos: null
}

export const HUD_MODES: { id: HudMode; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'flash', label: 'On switch' },
  { id: 'pinned', label: 'Always' }
]

export const HUD_SIZES: { id: HudSize; label: string }[] = [
  { id: 'compact', label: 'Compact' },
  { id: 'slim', label: 'Slim' },
  { id: 'comfy', label: 'Comfy' }
]

/** Keep an opacity inside its range and to whole percents (a slider can send 0.30000000000000004). */
export const clampOpacity = (n: number): number =>
  Math.round(Math.min(1, Math.max(MIN_HUD_OPACITY, n)) * 100) / 100
