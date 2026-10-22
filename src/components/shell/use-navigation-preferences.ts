'use client'

/**
 * @file use-navigation-preferences.ts
 * @project SlothVault
 * @module Workspace Navigation Preferences
 * @description Persists independent sidebar and group preferences without reading browser state during server rendering.
 * @logic Hydrate through an external store, expand the active route group on navigation, and tolerate unavailable or corrupt storage.
 * @dependencies React, browser localStorage
 * @index_tags navigation,preferences,hydration,sidebar
 * @author holic512
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react'

export type NavigationPreferences = { collapsed: boolean; openGroups: string[]; route: string }
const initial: NavigationPreferences = { collapsed: false, openGroups: [], route: '' }
const stores = new Map<string, NavigationPreferences>()
const listeners = new Map<string, Set<() => void>>()

export function parseNavigationPreferences(value: string | null): NavigationPreferences {
  try {
    const data = JSON.parse(value ?? '{}')
    return {
      collapsed: data?.collapsed === true,
      openGroups: Array.isArray(data?.openGroups)
        ? [...new Set<string>(data.openGroups.filter((key: unknown) => typeof key === 'string' && key.length < 100))].slice(0, 50)
        : [],
      route: '',
    }
  } catch { return initial }
}

export function expandNavigationGroup(value: NavigationPreferences, group: string | undefined, route: string): NavigationPreferences {
  if (value.route === route) return value
  return { ...value, route, openGroups: group && !value.openGroups.includes(group) ? [...value.openGroups, group] : value.openGroups }
}

function snapshot(key: string) {
  if (!stores.has(key)) {
    let saved: string | null = null
    try { saved = window.localStorage.getItem(key) } catch { /* Private browsing may deny storage. */ }
    stores.set(key, parseNavigationPreferences(saved))
  }
  return stores.get(key)!
}

function publish(key: string, value: NavigationPreferences, persist = true) {
  stores.set(key, value)
  if (persist) {
    try { window.localStorage.setItem(key, JSON.stringify({ collapsed: value.collapsed, openGroups: value.openGroups })) } catch { /* Navigation remains usable without persistence. */ }
  }
  listeners.get(key)?.forEach(listener => listener())
}

export function useNavigationPreferences(surface: 'admin' | 'account', activeGroup: string | undefined, route: string) {
  const key = `slothvault.navigation.${surface}`
  const subscribe = useCallback((listener: () => void) => {
    const entries = listeners.get(key) ?? new Set<() => void>()
    entries.add(listener)
    listeners.set(key, entries)
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) publish(key, parseNavigationPreferences(event.newValue), false)
    }
    window.addEventListener('storage', onStorage)
    return () => { entries.delete(listener); window.removeEventListener('storage', onStorage) }
  }, [key])
  const getSnapshot = useCallback(() => snapshot(key), [key])
  const stored = useSyncExternalStore(subscribe, getSnapshot, () => initial)
  // Derived state makes the destination visible immediately, before the effect persists it.
  const current = expandNavigationGroup(stored, activeGroup, route)
  useEffect(() => {
    const before = snapshot(key)
    const after = expandNavigationGroup(before, activeGroup, route)
    if (after !== before) publish(key, after)
  }, [key, activeGroup, route])
  return {
    collapsed: current.collapsed,
    openGroups: current.openGroups,
    setCollapsed: (collapsed: boolean) => publish(key, { ...expandNavigationGroup(snapshot(key), activeGroup, route), collapsed }),
    setOpenGroups: (openGroups: string[]) => publish(key, { ...expandNavigationGroup(snapshot(key), activeGroup, route), openGroups }),
  }
}
