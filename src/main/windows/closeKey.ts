/** The subset of Electron's `Input` that matters for the close accelerator. */
export interface KeyInput {
  type: string
  key: string
  control?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
}

/**
 * Ctrl/Cmd+W with no Shift/Alt. The default menu's `close` role would quit the app from the main window
 * (the menu is only hidden, its accelerators stay live), so the main window swallows it.
 */
export function isCloseAccelerator(input: KeyInput): boolean {
  return input.type === 'keyDown' && input.key.toLowerCase() === 'w' && (input.control === true || input.meta === true) && !input.shift && !input.alt
}
