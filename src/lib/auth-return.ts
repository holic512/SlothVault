/**
 * @file auth-return.ts
 * @project SlothVault
 * @module Authentication Return Boundary
 * @description Restricts login return targets to invitations and normalized administrator routes.
 * @logic Reject encoded, external or traversal targets and prevent non-administrators from returning to the console.
 * @dependencies none
 * @index_tags auth,redirect,permissions
 * @author holic512
 */
export const ADMIN_LOGIN_URL = '/login?next=/admin/mm'

export function safeAuthReturn(value: string | null | undefined) {
  if (!value) return '/account'
  if (/^\/commission-invitations\/[A-Za-z0-9_-]{43}$/.test(value)) return value
  if (/^\/admin\/mm(?:\/[A-Za-z0-9_-]+)*$/.test(value)) return value
  return '/account'
}

export function authorizedAuthReturn(value: string | null | undefined, role: string) {
  const target = safeAuthReturn(value)
  return target.startsWith('/admin/mm') && role !== 'ADMIN' ? '/account' : target
}
