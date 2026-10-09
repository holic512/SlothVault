/**
 * @file page.tsx
 * @project SlothVault
 * @module Default Administrator Settings Route
 * @description Keeps the existing settings entry linked to its default child page.
 * @logic Redirect the settings index to the branding section within the protected administrator route tree.
 * @dependencies Next navigation, admin-settings-draft
 * @index_tags admin,settings,routing,redirect
 * @author holic512
 */
import { redirect } from 'next/navigation'

import { getSettingsSectionPath } from '@/lib/admin-settings-draft'

export default function SettingsPage() {
  redirect(getSettingsSectionPath('branding'))
}
