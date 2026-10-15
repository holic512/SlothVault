/**
 * @file remembered-account.ts
 * @project SlothVault
 * @module Remembered Login Identifier
 * @description Stores only an explicitly remembered username or email, with legacy-key migration.
 * @logic Treat unavailable browser storage as optional, migrate the old identifier once, and never persist credentials or session preferences.
 * @dependencies browser localStorage
 * @index_tags login,privacy,storage
 * @author holic512
 */
export const REMEMBERED_ACCOUNT_KEY = 'sv_remembered_identifier'
export const LEGACY_ACCOUNT_KEY = 'admin_remembered_username'

function storage() { return window.localStorage }

export function readRememberedAccount(getStorage: () => Storage = storage): string {
  try {
    const store = getStorage()
    const current = store.getItem(REMEMBERED_ACCOUNT_KEY)
    if (current !== null) return current.slice(0, 255)
    const legacy = store.getItem(LEGACY_ACCOUNT_KEY)?.trim().slice(0, 255) || ''
    if (legacy) {
      store.setItem(REMEMBERED_ACCOUNT_KEY, legacy)
      store.removeItem(LEGACY_ACCOUNT_KEY)
    }
    return legacy
  } catch { return '' }
}

export function saveRememberedAccount(identifier: string | null, getStorage: () => Storage = storage) {
  try {
    const store = getStorage()
    if (identifier?.trim()) store.setItem(REMEMBERED_ACCOUNT_KEY, identifier.trim().slice(0, 255))
    else store.removeItem(REMEMBERED_ACCOUNT_KEY)
    store.removeItem(LEGACY_ACCOUNT_KEY)
  } catch { /* Optional storage must never turn a successful login into an error. */ }
}
