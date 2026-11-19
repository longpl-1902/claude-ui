import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { devCspPlugin } from './scripts/devCsp'

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer/src')
}

export default defineConfig({
  main: {
    resolve: { alias },
    // electron-vite externalizes only `dependencies`; node-pty is optional, so list it explicitly.
    build: { externalizeDeps: { include: ['node-pty'] } }
  },
  preload: {
    resolve: { alias },
    build: {
      // Single-file bundle so the sandboxed preload never requires local files.
      rollupOptions: {
        output: { inlineDynamicImports: true }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    // dedupe: one React however the cwd is spelled (see scripts/electron-vite.mjs).
    resolve: { alias, dedupe: ['react', 'react-dom'] },
    plugins: [react(), devCspPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
})
