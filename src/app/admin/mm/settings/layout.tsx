/**
 * @file layout.tsx
 * @project SlothVault
 * @module Shared Administrator Settings Routes
 * @description Shares settings navigation, drafts, and configuration actions between independently addressable settings pages.
 * @logic Keep SettingsManager mounted while child routes change and inherit the existing administrator authorization boundary.
 * @dependencies SettingsManager, localized page metadata
 * @index_tags admin,settings,layout,routing,draft
 * @author holic512
 */
import type { ReactNode } from 'react'

import { SettingsManager } from '@/components/admin/settings-manager'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminSettings')
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <SettingsManager>{children}</SettingsManager>
}
