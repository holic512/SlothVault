import { safeAuthReturn } from '@/lib/auth-return'
import { AuthFrame } from '@/components/auth/auth-frame'
import { UserLoginForm } from '@/components/auth/user-login-form'
import { SystemFilingFooter } from '@/components/shell/system-filing-footer'
import { createPageMetadata } from '@/i18n/metadata'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return createPageMetadata('login')
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const returnTo = safeAuthReturn((await searchParams).next)
  return <AuthFrame footer={<SystemFilingFooter />}><UserLoginForm returnTo={returnTo} /></AuthFrame>
}
