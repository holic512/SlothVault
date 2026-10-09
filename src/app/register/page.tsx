import { safeAuthReturn } from '@/lib/auth-return'
import { AuthFrame } from '@/components/auth/auth-frame'
import { UserRegisterForm } from '@/components/auth/user-register-form'
import { SystemFilingFooter } from '@/components/shell/system-filing-footer'
import { createPageMetadata } from '@/i18n/metadata'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return createPageMetadata('register')
}

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const returnTo = safeAuthReturn((await searchParams).next)
  return <AuthFrame footer={<SystemFilingFooter />}><UserRegisterForm returnTo={returnTo} /></AuthFrame>
}
