/**
 * @file page.tsx
 * @project SlothVault
 * @module Administrator Updates Settings Route
 * @description Registers the updates settings page in the shared settings workspace.
 * @logic Render the updates section using the layout-owned configuration draft and actions.
 * @dependencies SettingsSection
 * @index_tags admin,settings,routing,updates
 * @author holic512
 */
import { SettingsSection } from '@/components/admin/settings-manager'

export default function UpdateSettingsPage() {
  return <SettingsSection section="updates" />
}
