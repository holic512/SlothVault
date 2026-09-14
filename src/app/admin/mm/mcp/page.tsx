/**
 * @file page.tsx
 * @project SlothVault
 * @module Administrator MCP Key Page
 * @description Renders the authenticated administrator's personal MCP Key management workspace.
 * @logic Delegate browser interaction to the scoped MCP Key manager while the parent administrator layout enforces the ordinary session boundary.
 * @dependencies McpKeysManager, localized page metadata
 * @index_tags admin,mcp,api-key,management,page
 * @author holic512
 */
import { McpKeysManager } from '@/components/admin/mcp-keys-manager'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminMcpKeys')
}

export default function McpKeysPage() {
  return <McpKeysManager />
}
