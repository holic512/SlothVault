import type { Metadata } from 'next'

import { AuthFrame } from '@/components/auth/auth-frame'
import { LoginForm } from '@/components/auth/login-form'

export const metadata: Metadata = { title: 'Admin Login' }

export default function AdminLoginPage() {
  return (
    <AuthFrame>
      <LoginForm />
    </AuthFrame>
  )
}
