'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type ThemeMode = 'light' | 'dark'
type ThemePalette = 'purple' | 'cyan' | 'emerald' | 'rose'

type ThemeState = {
  theme: ThemeMode
  palette: ThemePalette
  setTheme: (theme: ThemeMode) => void
  setPalette: (palette: ThemePalette) => void
}

const apply = (theme: ThemeMode, palette: ThemePalette) => {
  if (typeof document === 'undefined') {
    return
  }

  const html = document.documentElement
  html.classList.toggle('dark', theme === 'dark')
  ;['purple', 'cyan', 'emerald', 'rose'].forEach((item) => html.classList.remove(`theme-${item}`))
  html.classList.add(`theme-${palette}`)
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      palette: 'purple',
      setTheme: (theme) => {
        apply(theme, get().palette)
        set({ theme })
      },
      setPalette: (palette) => {
        apply(get().theme, palette)
        set({ palette })
      }
    }),
    {
      name: 'theme-storage',
      onRehydrateStorage: () => (state) => {
        if (state) {
          apply(state.theme, state.palette)
        }
      }
    }
  )
)
