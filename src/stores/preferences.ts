'use client'

/**
 * @file preferences.ts
 * @project SlothVault
 * @module Client Preferences
 * @description Stores the visual palette independently from light/dark mode and applies it across the React tree.
 * @logic Start SSR and the first client render from the same default palette, then manually rehydrate one validated persisted value after mount so the provider can synchronize its CSS class without a hydration mismatch.
 * @dependencies zustand
 * @index_tags zustand,theme,palette,preferences
 * @author holic512
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const palettes = ['purple', 'cyan', 'emerald', 'rose'] as const
export type Palette = (typeof palettes)[number]

type PreferencesState = {
  palette: Palette
  setPalette: (palette: Palette) => void
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      palette: 'purple',
      setPalette: (palette) => set({ palette }),
    }),
    {
      name: 'slothvault-preferences',
      partialize: (state) => ({ palette: state.palette }),
      skipHydration: true,
    },
  ),
)
