/**
 * @file page.tsx
 * @project SlothVault
 * @module Evidence Administration Route
 * @description Renders the protected evidence ledger and signing workflow inside the route-scoped administrator wallet layout.
 * @logic Delegate administrator authorization and wallet runtime ownership to the parent shell, then render the evidence workspace.
 * @dependencies EvidenceManager, administrator layout, page metadata
 * @index_tags admin,evidence,route,solana,wallet
 * @author holic512
 */
import { EvidenceManager } from '@/components/admin/evidence-manager'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminEvidence')
}

export default function EvidencePage() {
  return <EvidenceManager />
}
