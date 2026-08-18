/**
 * @file page.tsx
 * @project SlothVault
 * @module Account Contracts Route
 * @description Renders the authenticated user's private Web2 contract workspace.
 * @logic Rely on the account layout for authorization and isolate contract review, acceptance, and refusal in its own route.
 * @dependencies AccountContractsView, page metadata
 * @index_tags account,contracts,route,web2-signature
 * @author holic512
 */
import { AccountContractsView } from '@/components/account/account-contracts-view'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('accountContracts')
}

export default function AccountContractsPage() {
  return <AccountContractsView />
}
