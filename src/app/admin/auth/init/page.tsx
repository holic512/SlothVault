import type { Metadata } from 'next'

import { AuthFrame } from '@/components/auth/auth-frame'
import { InitForm } from '@/components/auth/init-form'

export const metadata: Metadata = { title: 'Initialize Admin' }

export default function AdminInitPage() {
  return (
    <AuthFrame>
      <InitForm />
    </AuthFrame>
  )
}
