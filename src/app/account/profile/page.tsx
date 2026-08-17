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
import { AccountProfileView } from '@/components/account/account-profile-view'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('accountProfile')
}

export default function AccountProfilePage() {
  return <AccountProfileView />
}
