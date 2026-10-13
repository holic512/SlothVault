import { createElement, type ComponentType, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { App } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { WalletLoginButton } from '@/components/auth/wallet-login-button'
import { AccountSecurityView } from '@/components/account/account-security-view'
import { AccountShell } from '@/components/account/account-shell'
import { PublicNavStyleContextProvider } from '@/components/providers/public-nav-style-context'
import { DEFAULT_PUBLIC_NAV_STYLE } from '@/theme/public-nav-style'
import type { SessionUser } from '@/types/user'
vi.mock('next-intl', () => ({ useLocale: () => 'zh', useTranslations: (namespace: string) => Object.assign((key: string) => `${namespace}.${key}`, { has: () => true }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/account/security' }))
afterEach(() => vi.restoreAllMocks())
// React's createElement typing requires the children prop even when it is passed as the third argument.
function withChildren<P extends { children: ReactNode }>(component: ComponentType<P>, props: Omit<P, 'children'>, child: ReactNode) {
  return createElement(component, props as P, child)
}
function render(child: ReactNode, client = new QueryClient()) {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined), warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const html = renderToString(createElement(QueryClientProvider, { client },
    withChildren(PublicNavStyleContextProvider, { initialPublicNavStyle: DEFAULT_PUBLIC_NAV_STYLE }, createElement(App, null, child))))
  expect(JSON.stringify([...errors.mock.calls, ...warnings.mock.calls])).not.toMatch(/Portal only work|Hydration|not defined/)
  client.clear()
  return html
}
it('server-renders the login wallet control with its picker closed', () => {
  const html = render(createElement(WalletLoginButton))
  expect(html).toContain('UserAuth.wallet.select')
  expect(html).not.toContain('role="dialog"')
})
it('server-renders the authenticated multi-wallet security page without forcing a browser portal', () => {
  const user: SessionUser = { id: '1', username: 'wallet_test', email: null, displayName: null, avatar: null, bio: null, role: 'USER', passwordConfigured: false, pointsBalance: 0, walletAddress: null, createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z' }
  const html = render(withChildren(AccountShell, { initialUser: user }, createElement(AccountSecurityView)))
  expect(html).toContain('AccountSecurity.walletAccountHint')
  expect(html).toContain('AccountSecurity.addWallet')
  expect(html).not.toContain('role="dialog"')
})

it('isolates wallet caches by account instead of showing a previous login', () => {
  const user: SessionUser = { id: '1', username: 'current_account', email: null, displayName: null, avatar: null, bio: null, role: 'USER', passwordConfigured: true, pointsBalance: 0, walletAddress: null, createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z' }
  const client = new QueryClient()
  const currentWallet = { id: '1', address: 'current_account_wallet', createdAt: user.createdAt }
  const previousWallet = { id: '2', address: 'previous_account_wallet', createdAt: user.createdAt }
  client.setQueryData(['account-wallets', '1'], [currentWallet])
  client.setQueryData(['account-wallets', '2'], [previousWallet])
  client.setQueryData(['account-wallets'], [previousWallet])
  const html = render(withChildren(AccountShell, { initialUser: user }, createElement(AccountSecurityView)), client)
  expect(html).toContain(currentWallet.address)
  expect(html).not.toContain(previousWallet.address)
})
