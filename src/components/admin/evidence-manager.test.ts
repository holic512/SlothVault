import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from 'antd'
import { afterEach, expect, it, vi } from 'vitest'
import { EvidenceManager } from './evidence-manager'

vi.mock('@/components/wallet/use-solana-wallet', () => ({
  useSolanaWallet: () => ({ address: null, walletName: null, canSignForNetwork: () => false }),
}))
vi.mock('next-intl', () => ({
  useLocale: () => 'zh', useTranslations: () => (key: string) => key,
}))

afterEach(() => vi.restoreAllMocks())

it('server-renders the closed issue Drawer without forcing a client-only Portal', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const client = new QueryClient()
  const html = renderToString(createElement(QueryClientProvider, { client }, createElement(App, null, createElement(EvidenceManager))))
  expect(html).toContain('admin-page')
  expect(html).not.toContain('ant-drawer-body')
  expect(JSON.stringify([...errors.mock.calls, ...warnings.mock.calls])).not.toMatch(/Portal only work|Hydration/)
  client.clear()
})
