/**
 * @file user.ts
 * @project SlothVault
 * @module User API Types
 * @description Defines browser-safe account and session-lifecycle DTOs shared by authentication and account screens.
 * @logic Mirror only fields intentionally exposed by the server userDto mapper and expose expiry metadata without exposing credentials or session tokens.
 * @dependencies none
 * @index_tags user,account,dto,client-contract
 * @author holic512
 */
export type SessionUser = {
  id: string
  username: string
  email: string | null
  displayName: string | null
  avatar: string | null
  bio: string | null
  role: string
  passwordConfigured: boolean
  pointsBalance: number
  walletAddress: string | null
  createdAt: string
  updatedAt: string
}

export type SessionRenewal = {
  user: SessionUser
  expiresAt: string
  absoluteExpiresAt: string
  persistent: boolean
}
