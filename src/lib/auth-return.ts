/**
 * @file auth-return.ts
 * @project SlothVault
 * @module Invitation Login Return
 * @description Restricts authentication return targets to the invitation landing route.
 * @logic Accept only known relative invitation routes and use the account home otherwise.
 * @dependencies none
 * @index_tags commissions,workflow,access
 * @author holic512
 */
/** Only allow the explicit invitation landing route as an authentication return target. */
export function safeAuthReturn(value: string | null | undefined) {
  return value && /^\/commission-invitations\/[A-Za-z0-9_-]{43}$/.test(value) ? value : '/account'
}
