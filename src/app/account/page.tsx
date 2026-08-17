/**
 * @file page.tsx
 * @project SlothVault
 * @module Account Overview Route
 * @description Renders the overview entry point inside the authenticated account workspace.
 * @logic Delegate shared authorization and navigation to the account layout, then show only high-level account status and shortcuts.
 * @dependencies AccountOverview, account layout
 * @index_tags account,overview,route
 * @author holic512
 */
import type { Metadata } from 'next'

import { AccountOverview } from '@/components/account/account-view'

export const metadata: Metadata = { title: '账户概览' }

export default function AccountPage() {
  return <AccountOverview />
}
