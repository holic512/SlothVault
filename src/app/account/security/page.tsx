/**
 * @file page.tsx
 * @project SlothVault
 * @module Account Security Route
 * @description Renders the dedicated password and wallet-login view inside the authenticated account workspace.
 * @logic Delegate shared authorization and navigation to the account layout, then isolate sensitive credential controls from profile editing.
 * @dependencies AccountSecurityView, account layout
 * @index_tags account,security,password,wallet,route
 * @author holic512
 */
import type { Metadata } from 'next'

import { AccountSecurityView } from '@/components/account/account-security-view'

export const metadata: Metadata = { title: '安全与登录' }

export default function AccountSecurityPage() {
  return <AccountSecurityView />
}
