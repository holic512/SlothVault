import { describe, expect, it } from 'vitest'
import { authorizedAuthReturn, safeAuthReturn } from './auth-return'
describe('authentication return allowlist', () => {
  it.each(['/admin/mm', '/admin/mm/projects/12', `/commission-invitations/${'a'.repeat(43)}`])('preserves an allowed target: %s', target => {
    expect(safeAuthReturn(target)).toBe(target)
    expect(authorizedAuthReturn(target, 'ADMIN')).toBe(target)
  })
  it.each(['https://evil.test', '//evil.test', '/admin/mm//evil', '/admin/mm/../users', '/admin/mm/%2e%2e', '/admin/mm%2fusers', '/admin/mm?next=https://evil.test', '/admin/mm#x', '/admin/mm\\evil', '/admin/mm-evil', '/login', undefined])('rejects unsafe target: %s', target => {
    expect(safeAuthReturn(target)).toBe('/account')
  })
  it('never sends a regular account back into an administrator login loop', () => {
    expect(authorizedAuthReturn('/admin/mm/users', 'USER')).toBe('/account')
    expect(authorizedAuthReturn(`/commission-invitations/${'a'.repeat(43)}`, 'USER')).toContain('/commission-invitations/')
  })
})
