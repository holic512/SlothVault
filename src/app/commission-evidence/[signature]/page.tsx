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
import { CommissionPublicEvidence } from '@/components/commissions/public-evidence'
export const metadata = { title: '委托存证核验', robots: { index: false, follow: false } }
export default async function Page({ params }: { params: Promise<{ signature: string }> }) { return <CommissionPublicEvidence signature={(await params).signature} /> }
