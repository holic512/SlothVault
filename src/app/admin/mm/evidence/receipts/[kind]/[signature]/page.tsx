/**
 * @file page.tsx
 * @project SlothVault
 * @module Protected Evidence Receipt Page
 * @description Opens either evidence network inside the administrator shell.
 * @logic Validate an active administrator before reading the receipt and conceal missing or unsupported receipts.
 * @dependencies Viewer authentication, receipt service, administrator receipt view
 * @index_tags admin,evidence,receipts,permissions
 * @author holic512
 */
import { notFound, redirect } from 'next/navigation'
import { AdminEvidenceReceipt } from '@/components/admin/evidence-receipt'
import { getPageViewer } from '@/server/auth/viewer'
import { isAdminRole } from '@/server/auth/roles'
import { HttpError } from '@/server/http/errors'
import { getAdminEvidenceReceipt } from '@/server/services/evidence-receipts'

export const dynamic = 'force-dynamic'
export default async function Page({ params }: { params: Promise<{ kind: string; signature: string }> }) {
  const viewer = await getPageViewer()
  if (!viewer) redirect('/login?next=/admin/mm/evidence')
  if (!isAdminRole(viewer.role)) redirect('/account')
  let receipt
  try {
    receipt = await getAdminEvidenceReceipt(await params)
  } catch (error) {
    if (error instanceof HttpError && (error.status === 400 || error.status === 404)) notFound()
    throw error
  }
  return <AdminEvidenceReceipt initial={receipt} />
}
