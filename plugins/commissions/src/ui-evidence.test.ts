import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import type { CommissionDetail, FrozenAction } from './domain'
const mocks = vi.hoisted(() => ({ wallet: vi.fn() }))
vi.mock('@slothvault/plugin-sdk/client', () => {
  const Container = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children)
  return { Alert: Container, Button: Container, Descriptions: Container, Space: Container, Typography: { Text: Container }, usePluginWallet: mocks.wallet, useQueryClient: () => ({ invalidateQueries: vi.fn() }) }
})
vi.mock('./ui', () => ({ ErrorNotice: () => null, Status: () => null, kindNames: { REQUEST: '需求提交' }, post: vi.fn(), publicUrl: () => '/extensions/slothvault.commissions/receipt', queryRoot: ['commissions'], useDate: () => (value: string) => value }))
import { EvidencePanel } from './ui-evidence'
const record = { id: 'record', kind: 'REQUEST', status: 'AWAITING_ADMIN', createdAt: '2026-10-23', digest: 'digest', signature: null } as FrozenAction
const detail = { commission: { id: 'commission', revision: 1 } } as CommissionDetail
beforeEach(() => vi.clearAllMocks())
it('renders customer evidence without requesting a wallet provider', () => {
  mocks.wallet.mockImplementation(() => { throw new Error('No wallet provider') })
  expect(renderToStaticMarkup(React.createElement(EvidencePanel, { detail, record, admin: false }))).toContain('你无需连接钱包')
  expect(mocks.wallet).not.toHaveBeenCalled()
})
it('loads the host wallet capability only for administrator evidence controls', () => {
  mocks.wallet.mockReturnValue({ connected: false })
  expect(renderToStaticMarkup(React.createElement(EvidencePanel, { detail, record, admin: true }))).toContain('连接管理员钱包并准备存证')
  expect(mocks.wallet).toHaveBeenCalledOnce()
})
