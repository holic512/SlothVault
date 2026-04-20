'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type LocaleState = {
  locale: string
  setLocale: (locale: string) => void
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: 'en',
      setLocale: (locale) => {
        document.cookie = `sloth-locale=${locale}; path=/; max-age=31536000; samesite=lax`
        set({ locale })
      }
    }),
    {
      name: 'locale-storage'
    }
  )
)
