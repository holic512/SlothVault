/**
 * @file page.tsx
 * @project SlothVault
 * @module Personal Account Page
 * @description Renders the authenticated user's profile, security, wallet, points, and gift-card workspace.
 * @logic Validate the HTTP-only session on the server, redirect anonymous visitors to login, then render the client account center in the public shell.
 * @dependencies next/headers, next/navigation, session service, PublicNavbar, AccountView
 * @index_tags account,profile,points,security,page
 * @author holic512
 */
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { AccountView } from '@/components/account/account-view'
import { PublicNavbar } from '@/components/shell/public-navbar'
import { readSessionToken, SESSION_COOKIE } from '@/server/auth/session'
import publicStyles from '@/styles/modules/public.module.css'

export const metadata: Metadata = { title: '账户中心' }
export const dynamic = 'force-dynamic'

export default async function AccountPage() {
  const cookieStore = await cookies()
  const session = await readSessionToken(cookieStore.get(SESSION_COOKIE)?.value)
  if (!session) redirect('/login')

  return (
    <div className={`${publicStyles.root} public-page account-page`}>
      <PublicNavbar />
      <AccountView />
    </div>
  )
}
