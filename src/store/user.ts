'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type UserState = {
  username: string
  setUsername: (username: string) => void
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      username: '',
      setUsername: (username) => set({ username })
    }),
    { name: 'user-storage' }
  )
)
