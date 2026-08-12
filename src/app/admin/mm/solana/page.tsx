import type { Metadata } from 'next'

import { redirect } from 'next/navigation'

export const metadata: Metadata = { title: '交易存证' }

export default function SolanaPage() {
  redirect('/admin/mm/evidence')
}
