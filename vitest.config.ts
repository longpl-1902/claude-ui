// Test conventions:
// - Default environment is node.
// - Renderer tests opt in to jsdom by starting the file with
//   "// @vitest-environment jsdom" and "import '@testing-library/jest-dom/vitest'".
//   There is intentionally no global setup file.
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    css: false
  }
})
