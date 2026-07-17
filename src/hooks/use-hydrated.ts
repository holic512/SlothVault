'use client'

import { useSyncExternalStore } from 'react'

const subscribe = () => () => undefined

export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false)
}
