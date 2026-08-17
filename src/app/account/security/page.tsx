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
import { AccountSecurityView } from '@/components/account/account-security-view'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('accountSecurity')
}

export default function AccountSecurityPage() {
  return <AccountSecurityView />
}
