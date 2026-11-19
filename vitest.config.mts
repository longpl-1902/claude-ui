// Test conventions:
// - Default environment is node.
// - Renderer tests opt in to jsdom by starting the file with
//   "// @vitest-environment jsdom" and "import '@testing-library/jest-dom/vitest'".
//   There is intentionally no global setup file.
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// On Windows a shell may start with a lowercase drive letter (d:\...), which makes
// the same module resolve under two paths (d: vs D:) and load two vitest copies.
// Use process.cwd() as root so module paths match the casing the CLI was started with.
const root = process.cwd()

export default defineConfig({
  root,
  resolve: {
    alias: [
      // Exact match only: keep the test files' 'vitest' import on the same module
      // instance as the CLI (see the drive-letter note above).
      { find: /^vitest$/, replacement: resolve(root, 'node_modules/vitest/dist/index.js') },
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
