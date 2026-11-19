import type { ConsoleApi } from '../shared/ipc'

declare global {
  interface Window {
    api?: ConsoleApi
  }
}

export {}
