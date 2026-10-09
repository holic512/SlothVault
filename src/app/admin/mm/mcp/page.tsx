/**
 * @file page.tsx
 * @project SlothVault
 * @module Administrator MCP Key Page
 * @description Renders the authenticated administrator's personal MCP Key management workspace.
 * @logic Verify the administrator session and key the client workspace by owner so cached metadata and one-time disclosure cannot cross accounts.
 * @dependencies McpKeysManager, session service, next/headers, next/navigation
 * @index_tags admin,mcp,api-key,management,page
 * @author holic512
 */
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { McpKeysManager } from '@/components/admin/mcp-keys-manager'
import { createPageMetadata } from '@/i18n/metadata'
import { isAdminRole } from '@/server/auth/roles'
import { readSessionToken, SESSION_COOKIE } from '@/server/auth/session'

export async function generateMetadata() {
  return createPageMetadata('adminMcpKeys')
}

export default async function McpKeysPage() {
  const cookieStore = await cookies()
  const session = await readSessionToken(cookieStore.get(SESSION_COOKIE)?.value)
  if (!session || !isAdminRole(session.User.role)) redirect('/admin/auth/login')
  const administratorId = session.User.id.toString()
  return <McpKeysManager key={administratorId} administratorId={administratorId} />
}
