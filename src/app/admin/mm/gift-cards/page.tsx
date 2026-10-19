/**
 * @file page.tsx
 * @project SlothVault
 * @module Legacy Gift-card Plugin Page
 * @description Keeps the historical URL while rendering only the enabled authorized card plugin contribution.
 * @logic Delegate rendering and permissions to the plugin UI boundary; never invoke legacy business logic.
 * @dependencies plugin UI, guarded administrator layout
 * @index_tags plugins,admin,pages,compatibility
 * @author holic512
 */
import { PluginPageView } from '@/components/plugins/plugin-ui'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminGiftCards')
}

export default function GiftCardsPage() {
  return <PluginPageView pluginId="slothvault.gift-cards" surface="admin" />
}
