/**
 * @file page.tsx
 * @project SlothVault
 * @module Account Points Route
 * @description Renders the dedicated point balance, redemption, and ledger view inside the authenticated account workspace.
 * @logic Delegate shared authorization and navigation to the account layout, then keep point operations separate from profile and security settings.
 * @dependencies AccountPointsView, account layout
 * @index_tags account,points,ledger,route
 * @author holic512
 */
import { AccountPointsView } from '@/components/account/account-points-view'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('accountPoints')
}

export default function AccountPointsPage() {
  return <AccountPointsView />
}
