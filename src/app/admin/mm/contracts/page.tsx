/**
 * @file page.tsx
 * @project SlothVault
 * @module Contract Administration Route
 * @description Renders the protected contract administration workspace with the browser-only administrator wallet runtime.
 * @logic Keep contract drafting and Web2 signature management inside the admin boundary, then load wallet capabilities only for explicit chain anchoring.
 * @dependencies ContractsManager, WalletRuntime, page metadata
 * @index_tags admin,contracts,route,solana,web2-signature
 * @author holic512
 */
import { ContractsManager } from '@/components/admin/contracts-manager'
import { WalletRuntime } from '@/components/providers/wallet-runtime'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminContracts')
}

export default function ContractsPage() {
  return <WalletRuntime><ContractsManager /></WalletRuntime>
}
