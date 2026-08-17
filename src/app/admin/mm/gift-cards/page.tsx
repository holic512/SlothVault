import { GiftCardsManager } from '@/components/admin/gift-cards-manager'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminGiftCards')
}

export default function GiftCardsPage() {
  return <GiftCardsManager />
}
