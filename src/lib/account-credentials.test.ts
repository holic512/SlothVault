import { describe, expect, it } from 'vitest'
import { accountActionTarget, usernameChangeQuota } from './account-credentials'
describe('Beijing calendar username quota', () => {
  it('resets at Beijing midnight rather than host local time or rolling 30 days', () => {
    const user = { usernameChangeMonth: '2026-10', usernameChangeCount: 3 }
    expect(usernameChangeQuota(user, new Date('2026-10-31T15:59:59.999Z'))).toEqual({ month: '2026-10', used: 3, remaining: 0, limit: 3, resetsAt: '2026-10-31T16:00:00.000Z' })
    expect(usernameChangeQuota(user, new Date('2026-10-31T16:00:00.000Z'))).toMatchObject({ month: '2026-11', used: 0, remaining: 3 })
  })
  it('handles year boundaries', () => { expect(usernameChangeQuota({ usernameChangeMonth: null, usernameChangeCount: 0 }, new Date('2026-12-31T16:00:00.000Z')).resetsAt).toBe('2027-01-31T16:00:00.000Z') })
  it('normalizes human usernames but never changes wallet addresses or contains passwords', () => {
    expect(accountActionTarget({ action: 'credentials', username: ' My_Name ', passwordChange: true })).toBe('{"action":"credentials","username":"my_name","passwordChange":true}')
    expect(accountActionTarget({ action: 'bind', address: 'AbCd' })).toContain('AbCd')
  })
})
