/**
 * @file page.tsx
 * @project SlothVault
 * @module Administrator Filing Settings Route
 * @description Registers the filing settings page in the shared settings workspace.
 * @logic Render the filing section using the layout-owned configuration draft and actions.
 * @dependencies SettingsSection
 * @index_tags admin,settings,routing,filing
 * @author holic512
 */
import { SettingsSection } from '@/components/admin/settings-manager'

export default function FilingSettingsPage() {
  return <SettingsSection section="filing" />
}
