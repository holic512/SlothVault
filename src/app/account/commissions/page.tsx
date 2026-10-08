/**
 * @file page.tsx
 * @project SlothVault
 * @module Commission Workspace Route
 * @description Opens the authenticated private commission workspace.
 * @logic Use the protected layout and let the commission API enforce customer ownership.
 * @dependencies CommissionWorkspace, protected layout
 * @index_tags commissions,route,workspace
 * @author holic512
 */
import { CommissionWorkspace } from '@/components/commissions/workspace'
import { createPageMetadata } from '@/i18n/metadata'
export async function generateMetadata() { return createPageMetadata('accountCommissions') }
export default function Page() { return <CommissionWorkspace admin={false} /> }
