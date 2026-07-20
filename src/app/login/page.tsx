import type { Metadata } from 'next'

import { AuthFrame } from '@/components/auth/auth-frame'
import { UserLoginForm } from '@/components/auth/user-login-form'

export const metadata: Metadata = { title: '登录' }

export default function LoginPage() {
  return <AuthFrame><UserLoginForm /></AuthFrame>
}
