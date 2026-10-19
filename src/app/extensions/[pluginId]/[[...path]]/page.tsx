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
import { PublicNavbar } from '@/components/shell/public-navbar'
import { getSystemBranding } from '@/server/services/system-branding'
import styles from '@/styles/modules/public.module.css'
export const dynamic = 'force-dynamic'
export default async function ExtensionPage({ params }: { params: Promise<{ pluginId: string; path?: string[] }> }) {
  const { pluginId, path } = await params
  return <div className={`${styles.root} public-page`}><PublicNavbar branding={await getSystemBranding()} /><main className="content-container"><PluginPageView pluginId={pluginId} surface="public" path={path} /></main></div>
}
