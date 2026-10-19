import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@slothvault/plugin-sdk': fileURLToPath(new URL('./plugins/sdk/src', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@generated': fileURLToPath(new URL('./generated', import.meta.url)),
      'server-only': fileURLToPath(
        new URL('./src/test/server-only.ts', import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    setupFiles: ['./src/test/runtime-paths.ts'],
    environment: 'node',
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
    exclude: ['node_modules', '.next', 'dist', 'tests/visual'],
  },
})
