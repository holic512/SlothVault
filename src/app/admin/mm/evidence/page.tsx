import { EvidenceManager } from '@/components/admin/evidence-manager'
import { createPageMetadata } from '@/i18n/metadata'
import { WalletRuntime } from '@/components/providers/wallet-runtime'

export async function generateMetadata() {
  return createPageMetadata('adminEvidence')
}

export default function EvidencePage() {
  return <WalletRuntime><EvidenceManager /></WalletRuntime>
}
