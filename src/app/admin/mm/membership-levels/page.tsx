import { MembershipLevelsManager } from '@/components/admin/membership-levels-manager'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminMembershipLevels')
}

export default function MembershipLevelsPage() {
  return <MembershipLevelsManager />
}
