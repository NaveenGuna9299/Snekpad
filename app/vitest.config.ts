import { defineConfig } from 'vitest/config'

// Most tests run in plain Node. The UI tests (tests/ui) switch to jsdom with a
// `// @vitest-environment jsdom` comment on their first line.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: { include: ['tests/**/*.test.{ts,tsx}'], setupFiles: ['tests/setup.ts'] }
})
