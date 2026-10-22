import { Suspense } from 'react'
/**
 * @file page.tsx
 * @project SlothVault
 * @module Plugin Management Page
 * @description Hosts trusted plugin installation and lifecycle administration inside the guarded admin layout.
 * @logic Delegate rendering and permissions to the plugin UI boundary; never invoke legacy business logic.
 * @dependencies plugin UI, guarded administrator layout
 * @index_tags plugins,admin,pages,compatibility
 * @author holic512
 */
import { PluginsManager } from '@/components/admin/plugins-manager'
export default function PluginsPage() { return <Suspense><PluginsManager /></Suspense> }
