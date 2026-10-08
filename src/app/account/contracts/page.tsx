/**
 * @file page.tsx
 * @project SlothVault
 * @module Account Contracts Route
 * @description Redirects the former contract entry to the commission workspace.
 * @logic Preserve the old URL while routing customer cooperation to its commission workspace.
 * @dependencies Next redirect, account authorization layout
 * @index_tags account,contracts,route,web2-signature
 * @author holic512
 */
import { redirect } from 'next/navigation'
export default function Page() { redirect('/account/commissions') }
