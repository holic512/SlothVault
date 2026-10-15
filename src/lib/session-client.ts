/**
 * @file session-client.ts
 * @project SlothVault
 * @module Client Identity Boundary
 * @description Shares session reads and identity transitions across login, logout, and credential changes.
 * @logic Cancel in-flight queries before clearing identity-bound caches and broadcast only a change signal, never credentials or user data.
 * @dependencies React Query, api-client, browser events
 * @index_tags session,cache,logout,cross-tab
 * @author holic512
 */
import type { QueryClient } from '@tanstack/react-query'
import { ApiClientError, apiFetch } from '@/lib/api-client'
import type { SessionUser } from '@/types/user'

export const SESSION_QUERY_KEY = ['session-user'] as const
export const SESSION_CHANGE_EVENT = 'sv-session-change'
export const SESSION_CHANNEL = 'sv-session'
const SESSION_SIGNAL_KEY = 'sv_session_changed'

export async function fetchSessionUser({ signal }: { signal?: AbortSignal } = {}) {
  try { return await apiFetch<SessionUser | null>('/api/auth/session', { signal, cache: 'no-store' }) }
  catch (error) {
    if (error instanceof ApiClientError && error.status === 401) return null
    throw error
  }
}

export function broadcastSessionChange() {
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT))
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(SESSION_CHANNEL)
      channel.postMessage('changed')
      channel.close()
    } else {
      // Fallback contains only a nonce; neither tokens nor identity are persisted.
      window.localStorage.setItem(SESSION_SIGNAL_KEY, `${Date.now()}-${Math.random()}`)
    }
  } catch { /* Other tabs still validate on focus and activity if messaging is unavailable. */ }
}

export function isSessionStorageSignal(key: string | null) { return key === SESSION_SIGNAL_KEY }

export async function replaceClientSession(client: QueryClient, user: SessionUser | null, broadcast = true) {
  // Publish locally before cancellation so a late renewal cannot reinstall the old identity.
  window.dispatchEvent(new Event(SESSION_CHANGE_EVENT))
  await client.cancelQueries()
  // Keep the observed session query itself so all mounted consumers receive the change.
  client.removeQueries({ predicate: query => query.queryKey[0] !== SESSION_QUERY_KEY[0] })
  client.getMutationCache().clear()
  client.setQueryData(SESSION_QUERY_KEY, user)
  if (broadcast) broadcastSessionChange()
}
