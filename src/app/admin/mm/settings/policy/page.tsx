/**
 * @file page.tsx
 * @project SlothVault
 * @module Administrator Policy Settings Route
 * @description Registers the policy settings page in the shared settings workspace.
 * @logic Render the policy section using the layout-owned configuration draft and actions.
 * @dependencies SettingsSection
 * @index_tags admin,settings,routing,policy
 * @author holic512
 */
import { SettingsSection } from '@/components/admin/settings-manager'

export default function PolicySettingsPage() {
  return <SettingsSection section="policy" />
}
