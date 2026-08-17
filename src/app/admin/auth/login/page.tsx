import { AuthFrame } from '@/components/auth/auth-frame'
import { LoginForm } from '@/components/auth/login-form'
import { createPageMetadata } from '@/i18n/metadata'

export const dynamic = 'force-dynamic'

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
