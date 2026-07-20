/**
 * @file admin-auth.ts
 * @project SlothVault
 * @module Admin Authentication Service
 * @description Owns administrator existence checks, first-account initialization, credential verification, and session issuance.
 * @logic Count administrators, serialize the first-account transaction, verify username/email credentials, and issue a duration-aware session.
 * @dependencies Prisma User model, server/auth/password, server/auth/session, server/http/errors
 * @index_tags admin,authentication,initialization,login,session,transaction
 * @author holic512
 */
import 'server-only'

import { hashPassword, verifyPassword } from '@/server/auth/password'
import { issueSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'

export type InitializeAdminInput = {
  username: string
  password: string
}

export type LoginAdminInput = {
  username: string
  password: string
  remember: boolean
  ip: string | null
  userAgent: string | null
}

export async function hasAdminAccount() {
  return (await prisma.user.count()) > 0
}

export async function initializeAdmin(input: InitializeAdminInput) {
  const password = await hashPassword(input.password)

  return prisma.$transaction(
    async (tx) => {
      const count = await tx.user.count()
      if (count > 0) {
        throw new HttpError('Admin already initialized', 409, 409)
      }

      return tx.user.create({
        data: { username: input.username, password },
        select: { id: true, username: true },
      })
    },
    { isolationLevel: 'Serializable' },
  )
}

export async function loginAdmin(input: LoginAdminInput) {
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: input.username }, { email: input.username }] },
  })

  if (!user || !(await verifyPassword(user.password, input.password))) {
    throw new HttpError('Invalid credentials', 401, 401)
  }

  const ttlMs = (input.remember ? 30 : 7) * 24 * 60 * 60 * 1000
  const session = await issueSession({
    userId: user.id,
    ttlMs,
    ip: input.ip,
    userAgent: input.userAgent,
  })

  return {
    user: { id: user.id, username: user.username },
    session,
  }
}
