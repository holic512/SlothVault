/**
 * @file page.tsx
 * @project SlothVault
 * @module Administrator Branding Settings Route
 * @description Registers the branding settings page in the shared settings workspace.
 * @logic Render the branding section using the layout-owned configuration draft and actions.
 * @dependencies SettingsSection
 * @index_tags admin,settings,routing,branding
 * @author holic512
 */
import { SettingsSection } from '@/components/admin/settings-manager'

export default function BrandingSettingsPage() {
  return <SettingsSection section="branding" />
}
