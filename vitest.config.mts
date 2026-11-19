// Test conventions:
// - Default environment is node.
// - Renderer tests opt in to jsdom by starting the file with
//   "// @vitest-environment jsdom" and "import '@testing-library/jest-dom/vitest'".
//   There is intentionally no global setup file.
// - Run through `npm test` / `npm run test:watch`: scripts/vitest.mjs normalises a
//   lowercase Windows drive letter in the cwd before vitest loads (see that file).
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const root = process.cwd()

export default defineConfig({
  root,
  resolve: {
    alias: [
      { find: '@shared', replacement: resolve(root, 'src/shared') },
      { find: '@renderer', replacement: resolve(root, 'src/renderer/src') }
    ]
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    css: false
  }
})
