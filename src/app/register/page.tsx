import { AuthFrame } from '@/components/auth/auth-frame'
import { UserRegisterForm } from '@/components/auth/user-register-form'
import { createPageMetadata } from '@/i18n/metadata'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return createPageMetadata('register')
}

export default function RegisterPage() {
  return <AuthFrame><UserRegisterForm /></AuthFrame>
}
