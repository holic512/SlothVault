/**
 * @file viewer.ts
 * @project SlothVault
 * @module Content Viewer Identity
 * @description Resolves trusted active viewer identities for route handlers and request-rendered pages.
 * @logic Validate the shared session cookie before passing identity to content authorization.
 * @dependencies auth/session, next/headers
 * @index_tags auth,viewer,session,content,permissions
 * @author holic512
 */
import 'server-only'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import type { AccessViewer } from '@/lib/content-access'
import { readSession, readSessionToken, SESSION_COOKIE } from './session'

function viewer(session: Awaited<ReturnType<typeof readSessionToken>>): AccessViewer {
  return session ? { userId: session.userId, role: session.User.role } : null
}

export async function getRequestViewer(request: NextRequest) {
  return viewer(await readSession(request))
}

export async function getPageViewer() {
  return viewer(await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value))
}
