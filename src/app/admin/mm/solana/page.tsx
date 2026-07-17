import type { Metadata } from 'next'

import { SolanaManager } from '@/components/admin/solana-manager'

export const metadata: Metadata = { title: 'Solana Management' }

export default function SolanaPage() {
  return <SolanaManager />
}
