/**
 * @file page.tsx
 * @project SlothVault
 * @module Legacy Administrator Initialization Route
 * @description Preserves the former administrator initialization URL while installation moves to the unified wizard.
 * @logic Redirect every request to the first-run installation route, where database and administrator state are coordinated.
 * @dependencies Next.js navigation
 * @index_tags admin,init,redirect,install
 * @author holic512
 */
import { redirect } from 'next/navigation'

export default function AdminInitPage() {
  redirect('/install')
}
