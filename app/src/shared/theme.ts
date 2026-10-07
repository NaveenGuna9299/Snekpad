// Colour theme choice, shared by the main process (window chrome) and the renderer (settings).
import { z } from 'zod'

export const themePrefSchema = z.enum(['system', 'dark', 'light'])
export type ThemePref = z.infer<typeof themePrefSchema>

/** Colours of the native window frame (the OS draws the buttons over our title bar). Keep in step with main.css. */
export function chromeColors(dark: boolean): { background: string; symbol: string } {
  return dark
    ? { background: '#1a1b1e', symbol: '#b5bac1' }
    : { background: '#ffffff', symbol: '#4e5058' }
}
