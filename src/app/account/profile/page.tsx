/**
 * @file page.tsx
 * @project SlothVault
 * @module Account Profile Route
 * @description Renders the dedicated profile editing view inside the authenticated account workspace.
 * @logic Delegate shared authorization and navigation to the account layout, then expose only profile fields for editing.
 * @dependencies AccountProfileView, account layout
 * @index_tags account,profile,route
 * @author holic512
 */
import type { Metadata } from 'next'

import { AccountProfileView } from '@/components/account/account-profile-view'

export const metadata: Metadata = { title: '个人资料' }

export default function AccountProfilePage() {
  return <AccountProfileView />
}
