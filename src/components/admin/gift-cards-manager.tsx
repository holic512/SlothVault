/**
 * @file gift-cards-manager.tsx
 * @project SlothVault
 * @module Gift-card UI Compatibility
 * @description Preserves the component entry while rendering the independently installed card plugin.
 * @logic Delegate visibility and loading to the authorized plugin UI registry.
 * @dependencies PluginPageView
 * @index_tags plugins,gift-cards,compatibility
 * @author holic512
 */
import { PluginPageView } from '@/components/plugins/plugin-ui'
export function GiftCardsManager() { return <PluginPageView pluginId="slothvault.gift-cards" surface="admin" /> }
