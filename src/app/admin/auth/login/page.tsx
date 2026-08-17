import { AuthFrame } from '@/components/auth/auth-frame'
import { LoginForm } from '@/components/auth/login-form'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminLogin')
}

export default function AdminLoginPage() {
  return (
    <AuthFrame>
      <LoginForm />
    </AuthFrame>
  )
}
