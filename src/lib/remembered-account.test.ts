import { describe, expect, it, vi } from 'vitest'
import { LEGACY_ACCOUNT_KEY, REMEMBERED_ACCOUNT_KEY, readRememberedAccount, saveRememberedAccount } from './remembered-account'
function memoryStorage() {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } } as Storage
  return { values, storage, getStorage: () => storage }
}
describe('remembered identifiers', () => {
  it('persists only the identifier and restores it for a new form', () => {
    const { values, getStorage } = memoryStorage()
    saveRememberedAccount(' User@Example.test ', getStorage)
    expect(readRememberedAccount(getStorage)).toBe('User@Example.test')
    expect([...values.keys()]).toEqual([REMEMBERED_ACCOUNT_KEY])
  })
  it('migrates the old administrator key once and prefers a newer remembered account', () => {
    const { storage, getStorage } = memoryStorage()
    storage.setItem(LEGACY_ACCOUNT_KEY, 'admin')
    expect(readRememberedAccount(getStorage)).toBe('admin')
    expect(storage.getItem(LEGACY_ACCOUNT_KEY)).toBeNull()
    storage.setItem(LEGACY_ACCOUNT_KEY, 'old')
    expect(readRememberedAccount(getStorage)).toBe('admin')
  })
  it('clears both keys when unchecked so the legacy key cannot reappear', () => {
    const { storage, values, getStorage } = memoryStorage()
    storage.setItem(LEGACY_ACCOUNT_KEY, 'admin'); storage.setItem(REMEMBERED_ACCOUNT_KEY, 'user')
    saveRememberedAccount(null, getStorage)
    expect(values.size).toBe(0)
    expect(readRememberedAccount(getStorage)).toBe('')
  })
  it('does not throw if storage access, writes, or removal are blocked', () => {
    const blocked = () => { throw new Error('SecurityError') }
    expect(readRememberedAccount(blocked)).toBe('')
    expect(() => saveRememberedAccount('user', blocked)).not.toThrow()
    const { storage, getStorage } = memoryStorage()
    vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    expect(() => saveRememberedAccount('user', getStorage)).not.toThrow()
    vi.spyOn(storage, 'removeItem').mockImplementation(() => { throw new Error('SecurityError') })
    expect(() => saveRememberedAccount(null, getStorage)).not.toThrow()
  })
})
