// __DEV_TOOLS__ is a build-time constant in the app (electron.vite.config.ts). Tests run the code unbuilt, so it is a
// global here: on by default (tests exercise the development tools), and a test can switch it off with
// vi.stubGlobal('__DEV_TOOLS__', false) to check what the production build does.
;(globalThis as { __DEV_TOOLS__?: boolean }).__DEV_TOOLS__ = true
