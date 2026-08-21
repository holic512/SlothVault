/**
 * @file page.tsx
 * @project SlothVault
 * @module Contract Administration Route
 * @description Renders the protected contract administration workspace inside the administrator wallet layout.
 * @logic Keep contract drafting and Web2 signature management inside the admin boundary, and receive wallet capabilities from the shared route-scoped shell only for explicit chain anchoring.
 * @dependencies ContractsManager, administrator layout, page metadata
 * @index_tags admin,contracts,route,solana,web2-signature
 * @author holic512
 */
import { ContractsManager } from '@/components/admin/contracts-manager'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminContracts')
}

export default function ContractsPage() {
  return <ContractsManager />
}
