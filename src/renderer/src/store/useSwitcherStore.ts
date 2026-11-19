import { create } from 'zustand'
import { useConsoleStore } from './useConsoleStore'

export interface SwitcherState {
  isOpen: boolean
  /** Ctrl+K. Opens on any screen (the switcher lives in the Team view, so this navigates there first). */
  open(): void
  close(): void
}

export const useSwitcherStore = create<SwitcherState>((set) => ({
  isOpen: false,
  open: () => {
    useConsoleStore.getState().navigate('team')
    set({ isOpen: true })
  },
  close: () => set({ isOpen: false })
}))
