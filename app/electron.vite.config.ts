import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The development tools (the key test and what it needs) are built into `npm run dev` and into the dev-tools
// build (`electron-vite build --mode devtools`), and compiled out of the production build.
export default defineConfig(({ mode }) => {
  const define = { __DEV_TOOLS__: JSON.stringify(mode !== 'production') }
  return {
    main: { define },
    // two preload scripts: the window's, and the small one for the HUD overlay
    preload: {
      define,
      build: {
        rollupOptions: {
          input: { index: resolve('src/preload/index.ts'), hud: resolve('src/preload/hud.ts') }
        }
      }
    },
    renderer: {
      define,
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src')
        }
      },
      plugins: [react(), tailwindcss()]
    }
  }
})
