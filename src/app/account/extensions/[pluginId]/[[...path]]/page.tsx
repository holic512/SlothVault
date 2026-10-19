/**
 * @file page.tsx
 * @project SlothVault
 * @module Plugin Page Entry
 * @description Hosts independently installed plugin pages within existing navigation and auth boundaries.
 * @logic Render only authorized enabled contributions from the runtime registry.
 * @dependencies PluginPageView, existing route layouts
 * @index_tags plugins,routing,pages
 * @author holic512
 */
import { PluginPageView } from '@/components/plugins/plugin-ui'
export const dynamic = 'force-dynamic'
export default async function ExtensionPage({ params }: { params: Promise<{ pluginId: string; path?: string[] }> }) {
  const { pluginId, path } = await params
  return <PluginPageView pluginId={pluginId} surface="account" path={path} />
}
