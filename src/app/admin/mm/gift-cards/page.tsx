import type { Metadata } from 'next'

import { GiftCardsManager } from '@/components/admin/gift-cards-manager'

export const metadata: Metadata = { title: '卡密管理' }

export default function GiftCardsPage() {
  return <GiftCardsManager />
}
