/**
 * @file session.ts
 * @project SlothVault
 * @module Authentication
 * @description Owns bounded shared sessions, atomic renewal, revocation, role guards, and persistent or browser-session cookies.
 * @logic Keep authentication time immutable, enforce a seven-day absolute cap, renew only active nonpersistent sessions, and never revive revoked identities.
 * @dependencies node:crypto, next/server, Prisma Session/User models, auth/roles
 * @index_tags auth,session,cookie,user,admin,role
 * @author holic512
 */
import 'server-only'

import { createHash, randomBytes, randomUUID } from 'node:crypto'

import type { Prisma } from '@generated/prisma-postgresql/client'
import type { NextRequest, NextResponse } from 'next/server'

import { isAdminRole, USER_STATUS } from '@/server/auth/roles'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'

export const SESSION_COOKIE = 'sv_session'
export const SESSION_ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000

export function sessionAbsoluteExpiresAt(session: { createdAt: Date }) {
  return new Date(session.createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS)
}

export function isSessionActive(session: {
  createdAt: Date
  expiresAt: Date
  revokedAt: Date | null
  User: { status: number }
}, now = Date.now()) {
  return !session.revokedAt && session.User.status === USER_STATUS.ACTIVE &&
    session.expiresAt.getTime() > now && sessionAbsoluteExpiresAt(session).getTime() > now
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export async function issueSession(options: {
  userId: number
  persistent?: boolean
  ip?: string | null
  userAgent?: string | null
}, client: Pick<Prisma.TransactionClient, 'session'> = prisma) {
  const persistent = options.persistent === true
  const createdAt = new Date()
  const ttlMs = persistent ? SESSION_ABSOLUTE_TTL_MS : DEFAULT_SESSION_TTL_MS
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(createdAt.getTime() + ttlMs)
  const session = await client.session.create({
    data: {
      id: randomUUID(),
      userId: options.userId,
      tokenHash: sha256(token),
      createdAt,
      persistent,
      expiresAt,
      ip: options.ip?.slice(0, 255) || null,
      userAgent: options.userAgent || null,
    },
  })

  return { token, expiresAt, persistent, sessionId: session.id }
}

export async function readSessionToken(token: string | undefined) {
  if (!token) return null

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { User: true },
  })

  return session && isSessionActive(session) ? session : null
}

/** Renewal changes expiry only; it never changes the token or authentication time. */
export async function renewSessionToken(token: string | undefined) {
  const session = await readSessionToken(token)
  if (!session) return null
  if (!session.persistent) {
    const now = new Date()
    const expiresAt = new Date(Math.min(
      now.getTime() + DEFAULT_SESSION_TTL_MS,
      sessionAbsoluteExpiresAt(session).getTime(),
    ))
    // A monotonic conditional update remains safe across processes, logout and disable races.
    await prisma.session.updateMany({
      where: {
        id: session.id,
        tokenHash: session.tokenHash,
        persistent: false,
        revokedAt: null,
        createdAt: { gt: new Date(now.getTime() - SESSION_ABSOLUTE_TTL_MS) },
        expiresAt: { gt: now, lt: expiresAt },
        User: { status: USER_STATUS.ACTIVE },
      },
      data: { expiresAt },
    })
  }
  // Re-read rather than returning the pre-update identity after a revoke/role change.
  return readSessionToken(token)
}

export async function readSession(request: NextRequest) {
  return readSessionToken(request.cookies.get(SESSION_COOKIE)?.value)
}

export async function requireAdminSession(request: NextRequest) {
  const session = await readSession(request)
  if (!session || !isAdminRole(session.User.role)) {
    throw new HttpError('Unauthorized', 401, 401)
  }
  return session
}

export async function requireUserSession(request: NextRequest) {
  const session = await readSession(request)
  if (!session) throw new HttpError('Unauthorized', 401, 401)
  return session
}

export async function revokeSessionToken(token: string | undefined) {
  if (!token) return

  await prisma.session.updateMany({
    where: { tokenHash: sha256(token), revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function revokeAllUserSessions(userId: number) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export function setSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date,
  persistent = false,
) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(persistent ? { expires: expiresAt } : {}),
  })
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(0),
  })
}
