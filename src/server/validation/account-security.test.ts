import { expect, it } from 'vitest'
import { walletChallengeSchema, walletIdSchema, credentialsSchema } from './account-security'
it('requires an explicit challenge purpose instead of inferring binding from a session', () => {
  expect(walletChallengeSchema.safeParse({ address: '1'.repeat(32) }).success).toBe(false)
  expect(walletChallengeSchema.safeParse({ purpose: 'login', address: '1'.repeat(32), userId: 1 }).success).toBe(false)
})
it('bounds wallet route identifiers to the persisted integer type', () => {
  expect(walletIdSchema.safeParse('2147483647').success).toBe(true)
  for (const value of ['0', '-1', '2147483648', '9007199254740991', '1.5']) expect(walletIdSchema.safeParse(value).success).toBe(false)
})
it('normalizes usernames and rejects credential changes without a proof', () => {
  expect(credentialsSchema.parse({ username: ' My_Name ', reauth: { method: 'password', password: 'known' } }).username).toBe('my_name')
  expect(credentialsSchema.safeParse({ newPassword: 'setup-password' }).success).toBe(false)
})
