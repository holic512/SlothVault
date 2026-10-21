/**
 * @file page.tsx
 * @project SlothVault
 * @module Commission Workflow Route
 * @description Connects the commission workflow page or authenticated API boundary.
 * @logic Validate route inputs and reject unavailable or test-network receipts before rendering the public verification control.
 * @dependencies Next.js, commission workflow modules
 * @index_tags commissions,workflow,access
 * @author holic512
 */
import { notFound } from 'next/navigation'
import { HttpError } from '@/server/http/errors'
import { getPublicWorkflowEvidenceReceipt } from '@/server/commissions/evidence'
import { CommissionPublicEvidence } from '@/components/commissions/public-evidence'
export const metadata = { title: '委托存证核验', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'
export default async function Page({ params }: { params: Promise<{ signature: string }> }) {
  const { signature } = await params
  try { await getPublicWorkflowEvidenceReceipt(signature) } catch (error) {
    if (error instanceof HttpError && (error.status === 404 || error.status === 400)) notFound()
    throw error
  }
  return <CommissionPublicEvidence signature={signature} />
}
