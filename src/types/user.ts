/**
 * @file user.ts
 * @project SlothVault
 * @module User API Types
 * @description Defines the browser-safe account DTO shared by navigation, authentication, and personal account screens.
 * @logic Mirror only fields intentionally exposed by the server userDto mapper and keep all credential/session storage server-only.
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
