import { redirect } from 'next/navigation'

import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminSolana')
}

export default function SolanaPage() {
  redirect('/admin/mm/evidence')
}
