/**
 * @file wallet-login.ts
 * @project SlothVault
 * @module Wallet Login Contract
 * @description Defines exact purpose-bound account messages shared by browser wallets and the server verifier.
 * @logic Bind the operation purpose and public target, address, random nonce, identifier and expiry into deterministic UTF-8 bytes without exposing passwords.
 * @dependencies none
 * @index_tags wallet,login,signature,contract,optional-auth
 * @author holic512
 */
export function buildWalletLoginMessage(input: {
  address: string
  challengeId: string
  nonce: string
  expiresAt: number
  purpose?: 'login' | 'bind' | 'replace' | 'reauth'
  target?: string | null
}) {
  return [
    input.purpose && input.purpose !== 'login' ? 'SlothVault account authorization' : 'SlothVault sign in',
    `purpose:account-${input.purpose ?? 'login'}`,
    ...(input.target ? [`target:${input.target}`] : []),
    `address:${input.address}`,
    `challenge:${input.challengeId}`,
    `nonce:${input.nonce}`,
    `expires:${input.expiresAt}`,
  ].join('\n')
}
