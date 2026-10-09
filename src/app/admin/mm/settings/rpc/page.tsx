/**
 * @file page.tsx
 * @project SlothVault
 * @module Administrator RPC Settings Route
 * @description Registers the rpc settings page in the shared settings workspace.
 * @logic Render the rpc section using the layout-owned configuration draft and actions.
 * @dependencies SettingsSection
 * @index_tags admin,settings,routing,rpc
 * @author holic512
 */
import { SettingsSection } from '@/components/admin/settings-manager'

export default function RpcSettingsPage() {
  return <SettingsSection section="rpc" />
}
