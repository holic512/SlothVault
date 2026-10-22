/**
 * @file page.tsx
 * @project SlothVault
 * @module Administrator Market Settings Route
 * @description Registers system-owned price sources in the shared settings workspace.
 * @logic Reuse layout-owned drafts, save/readback and independently bounded source tests.
 * @dependencies SettingsSection
 * @index_tags admin,settings,market,routing
 * @author holic512
 */
import { SettingsSection } from '@/components/admin/settings-manager'
export default function MarketSettingsPage() { return <SettingsSection section="market" /> }
