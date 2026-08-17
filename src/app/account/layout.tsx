/**
 * @file layout.tsx
 * @project SlothVault
 * @module Personal Account Routes
 * @description Guards every private account route and renders their shared public shell and account workspace.
 * @logic Validate the HTTP-only session once for the account route tree, serialize only browser-safe profile fields, then provide the shared navigation shell to each account section.
 * @dependencies Next cookies/navigation, auth session service, PublicNavbar, AccountShell
 * @index_tags account,layout,session,authorization,workspace
 * @author holic512
 */
import type { ReactNode } from 'react'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { AccountShell } from '@/components/account/account-shell'
import { PublicNavbar } from '@/components/shell/public-navbar'
import { readSessionToken, SESSION_COOKIE } from '@/server/auth/session'
import publicStyles from '@/styles/modules/public.module.css'
import type { SessionUser } from '@/types/user'

export const dynamic = 'force-dynamic'

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies()
  const session = await readSessionToken(cookieStore.get(SESSION_COOKIE)?.value)
  if (!session) redirect('/login')

  const user: SessionUser = {
    id: session.User.id.toString(),
    username: session.User.username,
    email: session.User.email,
    displayName: session.User.displayName,
    avatar: session.User.avatar,
    bio: session.User.bio,
    role: session.User.role,
    passwordConfigured: session.User.passwordConfigured,
    pointsBalance: session.User.pointsBalance,
    walletAddress: session.User.walletAddress,
    createdAt: session.User.createdAt.toISOString(),
    updatedAt: session.User.updatedAt.toISOString(),
  }

  return (
    <div className={`${publicStyles.root} public-page account-page`}>
      <PublicNavbar />
      <AccountShell initialUser={user}>{children}</AccountShell>
    </div>
  )
}
