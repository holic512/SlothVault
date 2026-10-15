/**
 * @file admin-auth.ts
 * @project SlothVault
 * @module Admin Authentication Service
 * @description Preserves legacy administrator authentication contracts through the shared identity service.
 * @logic Count administrators and adapt legacy inputs and DTOs without duplicating credential verification or session policy.
 * @dependencies Prisma User model, user-auth service, auth/roles
 * @index_tags admin,authentication,login,session,transaction
 * @author holic512
 */
import 'server-only'

import { USER_ROLE } from '@/server/auth/roles'
import { loginUser } from '@/server/services/user-auth'
import { prisma } from '@/server/prisma'

export type LoginAdminInput = {
  username: string
  password: string
  remember: boolean
  ip: string | null
  userAgent: string | null
}

export async function hasAdminAccount() {
  return (await prisma.user.count({ where: { role: USER_ROLE.ADMIN } })) > 0
}

export async function loginAdmin(input: LoginAdminInput) {
  const result = await loginUser({ ...input, identifier: input.username, requiredRole: USER_ROLE.ADMIN })
  return {
    user: { id: Number(result.user.id), username: result.user.username, role: result.user.role },
    session: result.session,
  }
}
