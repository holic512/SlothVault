/**
 * @file page.tsx
 * @project SlothVault
 * @module Account Membership Route
 * @description Renders the authenticated membership center within the personal account workspace.
 * @logic Delegate account authorization to the shared layout and mount the point-purchase membership experience.
 * @dependencies AccountMembershipView, account layout
 * @index_tags account,membership,route,points
 * @author holic512
 */
import { AccountMembershipView } from '@/components/account/account-membership-view'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('accountMembership')
}

export default function AccountMembershipPage() {
  return <AccountMembershipView />
}
