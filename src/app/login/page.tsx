import { AuthFrame } from '@/components/auth/auth-frame'
import { UserLoginForm } from '@/components/auth/user-login-form'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('login')
}

export default function LoginPage() {
  return <AuthFrame><UserLoginForm /></AuthFrame>
}
