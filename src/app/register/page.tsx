import type { Metadata } from 'next'

import { AuthFrame } from '@/components/auth/auth-frame'
import { UserRegisterForm } from '@/components/auth/user-register-form'

export const metadata: Metadata = { title: '注册' }

export default function RegisterPage() {
  return <AuthFrame><UserRegisterForm /></AuthFrame>
}
