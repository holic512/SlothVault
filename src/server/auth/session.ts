/**
 * @file session.ts
 * @project SlothVault
 * @module Authentication
 * @description Owns administrator session issuance, lookup, revocation, and secure cookie behavior.
 * @logic Store only SHA-256 token hashes, reject expired/revoked sessions, and expose one guard for all admin APIs.
 * @dependencies node:crypto, next/server, Prisma Session model
 * @index_tags auth,session,cookie,admin
 * @author holic512
 */
import 'server-only'

import { createHash, randomBytes, randomUUID } from 'node:crypto'

import type { NextRequest, NextResponse } from 'next/server'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'

export const SESSION_COOKIE = 'sv_session'
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export async function issueSession(options: {
  userId: number
  ttlMs?: number
  ip?: string | null
  userAgent?: string | null
}) {
  const ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + ttlMs)
  const session = await prisma.session.create({
    data: {
      id: randomUUID(),
      userId: options.userId,
      tokenHash: sha256(token),
      expiresAt,
      ip: options.ip?.slice(0, 255) || null,
      userAgent: options.userAgent || null,
    },
  })

  return { token, expiresAt, sessionId: session.id }
}

export async function readSessionToken(token: string | undefined) {
  if (!token) return null

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { User: true },
  })

  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    return null
  }

  return session
}

export async function readSession(request: NextRequest) {
  return readSessionToken(request.cookies.get(SESSION_COOKIE)?.value)
}

export async function requireAdminSession(request: NextRequest) {
  const session = await readSession(request)
  if (!session) {
    throw new HttpError('Unauthorized', 401, 401)
  }
  return session
}

export async function revokeSessionToken(token: string | undefined) {
  if (!token) return

  await prisma.session.updateMany({
    where: { tokenHash: sha256(token), revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export function setSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date,
) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
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
