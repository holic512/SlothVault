/**
 * @file page.tsx
 * @project SlothVault
 * @module Commission Workflow Route
 * @description Connects the commission workflow page or authenticated API boundary.
 * @logic Validate route inputs and delegate to the role-aware workflow service or shared page.
 * @dependencies Next.js, commission workflow modules
 * @index_tags commissions,workflow,access
 * @author holic512
 */
import { CommissionInvitationPage } from '@/components/commissions/invitation-page'
export const metadata = { title: '委托邀请', robots: { index: false, follow: false }, referrer: 'no-referrer' }
export default async function Page({ params }: { params: Promise<{ token: string }> }) { return <CommissionInvitationPage token={(await params).token} /> }
