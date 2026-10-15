import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import type { SessionUser } from '@/types/user'
import { broadcastSessionChange, replaceClientSession, SESSION_CHANGE_EVENT, SESSION_QUERY_KEY } from './session-client'
const postMessage = vi.fn(), close = vi.fn()
let client: QueryClient
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('BroadcastChannel', class { postMessage = postMessage; close = close })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.clearAllMocks()
})
afterEach(() => { client.clear(); vi.unstubAllGlobals() })
describe('client identity transitions', () => {
  it('clears prior private caches when a different account logs in', async () => {
    client.setQueryData(['account-wallets', '1'], ['private-wallet'])
    client.setQueryData(['admin-users'], ['private-admin-data'])
    const user = { id: '2', role: 'USER' } as SessionUser
    await replaceClientSession(client, user)
    expect(client.getQueryData(['admin-users'])).toBeUndefined()
    expect(client.getQueryData(['account-wallets', '1'])).toBeUndefined()
    expect(client.getQueryData(SESSION_QUERY_KEY)).toBe(user)
    expect(postMessage).toHaveBeenCalledWith('changed')
    expect(close).toHaveBeenCalled()
  })
  it('cancels in-flight query work before publishing a signed-out identity', async () => {
    let signal!: AbortSignal
    const pending = client.fetchQuery({ queryKey: ['private'], queryFn: ({ signal: requestSignal }) => {
      signal = requestSignal
      return new Promise(() => {})
    } }).catch(() => undefined)
    await replaceClientSession(client, null)
    await pending
    expect(signal.aborted).toBe(true)
    expect(client.getQueryData(SESSION_QUERY_KEY)).toBeNull()
    expect(client.getQueryData(['private'])).toBeUndefined()
  })
  it('notifies existing session observers instead of leaving them attached to a removed query', async () => {
    client.setQueryData(SESSION_QUERY_KEY, { id: '1' })
    const observer = new QueryObserver(client, { queryKey: SESSION_QUERY_KEY, enabled: false })
    const observed = vi.fn()
    const unsubscribe = observer.subscribe(observed)
    await replaceClientSession(client, null)
    expect(observer.getCurrentResult().data).toBeNull()
    expect(observed).toHaveBeenCalled()
    unsubscribe()
  })
  it('reconciles another tab without rebroadcasting its user details', async () => {
    const listener = vi.fn()
    window.addEventListener(SESSION_CHANGE_EVENT, listener)
    await replaceClientSession(client, null, false)
    expect(listener).toHaveBeenCalled()
    expect(postMessage).not.toHaveBeenCalled()
  })
  it('does not break login or logout when cross-tab transports are unavailable', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    expect(() => broadcastSessionChange()).not.toThrow()
  })
})
