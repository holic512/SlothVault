import { AuthFrame } from '@/components/auth/auth-frame'
import { UserLoginForm } from '@/components/auth/user-login-form'
import { SystemFilingFooter } from '@/components/shell/system-filing-footer'
import { createPageMetadata } from '@/i18n/metadata'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return createPageMetadata('login')
}

export default function LoginPage() {
  return <AuthFrame footer={<SystemFilingFooter />}><UserLoginForm /></AuthFrame>
}
