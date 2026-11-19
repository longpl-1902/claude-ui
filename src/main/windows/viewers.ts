import { DEFAULT_VIEWER, type ViewerId } from '../transcripts/viewer'
import type { ManagedWindow } from './windowManager'

/** A window's viewer id: its webContents id. The main window uses DEFAULT_VIEWER instead (see createViewerRouter). */
export const viewerIdOf = (senderId: number): ViewerId => `wc:${senderId}`

const SENDER_PREFIX = 'wc:'

/** Maps IPC callers (webContents ids) to transcript viewers and back to windows. */
export function createViewerRouter(get: () => { main(): ManagedWindow | undefined; all(): ManagedWindow[] } | undefined): {
  /** main's senderId, a negative id, or no manager -> DEFAULT_VIEWER */
  viewerOf(senderId: number): ViewerId
  /** DEFAULT_VIEWER -> main(); 'wc:N' -> the window whose senderId is N */
  windowOf(viewer: ViewerId): ManagedWindow | undefined
  /** No-op when the window is gone or destroyed. */
  send(viewer: ViewerId, channel: string, payload: unknown): void
  /** The window exists, is not destroyed and is not minimized. */
  isShown(viewer: ViewerId): boolean
} {
  const windowOf = (viewer: ViewerId): ManagedWindow | undefined => {
    const wm = get()
    if (!wm) return undefined
    if (viewer === DEFAULT_VIEWER) return wm.main()
    if (!viewer.startsWith(SENDER_PREFIX)) return undefined
    const n = Number(viewer.slice(SENDER_PREFIX.length))
    return wm.all().find((w) => w.senderId === n)
  }
  return {
    viewerOf(senderId) {
      const wm = get()
      if (!wm || senderId < 0) return DEFAULT_VIEWER
      const main = wm.main()
      if (!main || main.senderId === senderId) return DEFAULT_VIEWER
      return viewerIdOf(senderId)
    },
    windowOf,
    send(viewer, channel, payload) {
      const w = windowOf(viewer)
      if (!w || w.isDestroyed()) return
      try {
        w.send(channel, payload)
      } catch {
        // the window is going away
      }
    },
    isShown(viewer) {
      const w = windowOf(viewer)
      return !!w && !w.isDestroyed() && !w.isMinimized()
    }
  }
}
