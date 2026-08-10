import type { Metadata } from 'next'

import { SolanaManager } from '@/components/admin/solana-manager'
import { WalletRuntime } from '@/components/providers/wallet-runtime'

export const metadata: Metadata = { title: '版权凭证' }

export default function SolanaPage() {
  return (
    <WalletRuntime>
      <SolanaManager />
    </WalletRuntime>
  )
}
