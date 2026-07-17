/**
 * @file layout.tsx
 * @project SlothVault
 * @module Protected Administrator Boundary
 * @description Rejects unauthenticated admin page requests before rendering the React management shell.
 * @logic Read the HTTP-only session cookie on the server, validate it against PostgreSQL, and redirect invalid sessions.
 * @dependencies next/headers, next/navigation, session service, AdminShell
 * @index_tags admin,auth-guard,layout,server-component
 * @author holic512
 */
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { AdminShell } from '@/components/admin/admin-shell'
import { readSessionToken, SESSION_COOKIE } from '@/server/auth/session'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const session = await readSessionToken(cookieStore.get(SESSION_COOKIE)?.value)
  if (!session) redirect('/admin/auth/login')

  return <AdminShell username={session.User.username}>{children}</AdminShell>
}
