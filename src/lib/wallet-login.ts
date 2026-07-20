/**
 * @file wallet-login.ts
 * @project SlothVault
 * @module Wallet Login Contract
 * @description Defines the exact user-login message shared by the browser wallet and server verifier.
 * @logic Bind one address, random nonce, challenge identifier, expiry, and application domain into a deterministic UTF-8 message.
 * @dependencies none
 * @index_tags wallet,login,signature,contract,optional-auth
 * @author holic512
 */
export function buildWalletLoginMessage(input: {
  address: string
  challengeId: string
  nonce: string
  expiresAt: number
}) {
  return [
    'SlothVault sign in',
    'purpose:account-login',
    `address:${input.address}`,
    `challenge:${input.challengeId}`,
    `nonce:${input.nonce}`,
    `expires:${input.expiresAt}`,
  ].join('\n')
}
