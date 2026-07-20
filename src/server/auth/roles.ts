import 'server-only'

export const USER_ROLE = {
  ADMIN: 'ADMIN',
  USER: 'USER',
} as const

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE]

export const USER_STATUS = {
  DISABLED: 0,
  ACTIVE: 1,
} as const

export function isAdminRole(role: string) {
  return role === USER_ROLE.ADMIN
}
