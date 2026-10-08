/**
 * @file page.tsx
 * @project SlothVault
 * @module Contract Administration Route
 * @description Redirects the former standalone contract entry to the commission workspace.
 * @logic Preserve the old URL while routing administrator cooperation to the commission workspace.
 * @dependencies Next redirect, administrator authorization layout
 * @index_tags admin,contracts,route,solana,web2-signature
 * @author holic512
 */
import { redirect } from 'next/navigation'
export default function Page() { redirect('/admin/mm/commissions') }
