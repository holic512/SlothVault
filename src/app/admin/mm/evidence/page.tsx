import type { Metadata } from 'next'

import { EvidenceManager } from '@/components/admin/evidence-manager'
import { WalletRuntime } from '@/components/providers/wallet-runtime'

export const metadata: Metadata = { title: '交易存证' }

export default function EvidencePage() {
  return <WalletRuntime><EvidenceManager /></WalletRuntime>
}
