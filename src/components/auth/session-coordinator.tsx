'use client'
/**
 * @file session-coordinator.tsx
 * @project SlothVault
 * @module Shared Client Session Lifecycle
 * @description Coordinates bounded session renewal and cross-tab identity changes for public and administrator pages.
 * @logic Observe visible activity rather than background heartbeats, reconcile broadcasts against the server, and clear private caches on logout or role changes.
 * @dependencies React Query, session-renewal, session-client, Next navigation
 * @index_tags session,provider,renewal,cross-tab
 * @author holic512
 */
import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePathname, useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'
import { createSessionRenewalController } from '@/lib/session-renewal'
import { fetchSessionUser, isSessionStorageSignal, replaceClientSession, SESSION_CHANNEL, SESSION_CHANGE_EVENT, SESSION_QUERY_KEY } from '@/lib/session-client'
import type { SessionRenewal, SessionUser } from '@/types/user'

export function SessionCoordinator() {
  const client = useQueryClient(), router = useRouter(), pathname = usePathname()
  const active = pathname !== '/install' && pathname !== '/maintenance'
  const query = useQuery({ queryKey: SESSION_QUERY_KEY, queryFn: fetchSessionUser, enabled: active, retry: false, refetchOnWindowFocus: false })
  const activityRef = useRef<() => void>(() => {})
  const previousIdentity = useRef<string | null>(null)

  useEffect(() => {
    if (!active) return
    let disposed = false, revision = 0
    const reconcile = async () => {
      controller.reset()
      const currentRevision = ++revision
      try {
        const user = await fetchSessionUser()
        if (disposed || currentRevision !== revision) return
        const current = client.getQueryData<SessionUser | null>(SESSION_QUERY_KEY)
        if (current?.id !== user?.id || current?.role !== user?.role) {
          await replaceClientSession(client, user, false)
          if (!disposed) router.refresh()
        } else client.setQueryData(SESSION_QUERY_KEY, user)
      } catch { /* A network failure is not a logout. Activity will retry. */ }
    }
    const controller = createSessionRenewalController({
      renew: signal => apiFetch<SessionRenewal>('/api/auth/session/renew', { method: 'POST', body: '{}', signal, cache: 'no-store' }),
      apply: result => {
        const current = client.getQueryData<SessionUser | null>(SESSION_QUERY_KEY)
        if (current?.id !== result.user.id || current?.role !== result.user.role) {
          void replaceClientSession(client, result.user).then(() => router.refresh())
        } else client.setQueryData(SESSION_QUERY_KEY, result.user)
      },
      expired: () => { void replaceClientSession(client, null).then(() => router.refresh()) },
    })
    const activity = () => {
      void controller.activity(document.visibilityState === 'visible', Boolean(client.getQueryData(SESSION_QUERY_KEY)))
    }
    const reset = () => { revision++; controller.reset() }
    const storage = (event: StorageEvent) => { if (isSessionStorageSignal(event.key)) void reconcile() }
    const focus = () => {
      if (document.visibilityState !== 'visible') return
      if (client.getQueryData(SESSION_QUERY_KEY)) activity()
      else void reconcile()
    }
    activityRef.current = activity
    window.addEventListener(SESSION_CHANGE_EVENT, reset)
    window.addEventListener('storage', storage)
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    for (const event of ['pointerdown', 'keydown', 'scroll', 'touchstart']) document.addEventListener(event, activity, { passive: true })
    let channel: BroadcastChannel | undefined
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(SESSION_CHANNEL)
        channel.onmessage = event => { if (event.data === 'changed') void reconcile() }
      }
    } catch { /* Focus validation remains available. */ }
    activity()
    return () => {
      disposed = true
      reset()
      activityRef.current = () => {}
      channel?.close()
      window.removeEventListener(SESSION_CHANGE_EVENT, reset)
      window.removeEventListener('storage', storage)
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', focus)
      for (const event of ['pointerdown', 'keydown', 'scroll', 'touchstart']) document.removeEventListener(event, activity)
    }
  }, [active, client, router])

  useEffect(() => {
    if (query.data === undefined) return
    const identity = query.data ? `${query.data.id}:${query.data.role}` : null
    if (previousIdentity.current && previousIdentity.current !== identity) {
      void replaceClientSession(client, query.data).then(() => router.refresh())
    }
    previousIdentity.current = identity
    activityRef.current()
  }, [query.data, pathname, client, router])
  return null
}
