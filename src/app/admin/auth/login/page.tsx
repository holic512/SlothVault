/**
 * @file page.tsx
 * @project SlothVault
 * @module Legacy Login Redirect
 * @description Redirects the retired administrator login page to the unified login.
 * @logic Keep old bookmarks working without rendering a second authentication form.
 * @dependencies Next redirect, auth-return
 * @index_tags auth,admin,redirect,compatibility
 * @author holic512
 */
import { redirect } from 'next/navigation'
import { ADMIN_LOGIN_URL } from '@/lib/auth-return'

export default function AdminLoginPage() {
  redirect(ADMIN_LOGIN_URL)
}
