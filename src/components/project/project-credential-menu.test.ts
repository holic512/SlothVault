import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../messages/en.json'
const mocks = vi.hoisted(() => ({ result: {} as Record<string, unknown>, query: {} as Record<string, unknown>, menu: { items: [] as Array<{ key: string; disabled?: boolean; label: unknown }> } }))
vi.mock('next-intl', async load => ({ ...await load<typeof import('next-intl')>(), useLocale: () => 'en', useTranslations: () => createTranslator({ locale: 'en', messages: en, namespace: 'ProjectCredential' }) }))
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: Record<string, unknown>) => { mocks.query = options; return mocks.result } }))
vi.mock('antd', async load => ({
  ...await load<typeof import('antd')>(),
  Dropdown: ({ menu, children }: { menu: typeof mocks.menu; children: ReactNode }) => { mocks.menu = menu; return children },
  Drawer: ({ children }: { children: ReactNode }) => createElement('aside', null, children),
}))
import { ProjectCredentialMenu } from './project-credential-menu'
const render = (versionId = '2', preview = false) => renderToStaticMarkup(createElement(ProjectCredentialMenu, { projectId: '1', versionId, preview }))
describe('publication credential menu', () => {
  beforeEach(() => { mocks.result = { isPending: true, isFetching: false, isError: false, refetch: vi.fn() } })
  it('starts without a summary request and keeps exactly two actions with download disabled', () => {
    render()
    expect(mocks.query.enabled).toBe(false)
    expect(mocks.query.queryKey).toEqual(['project-credential', '1', '2', false])
    expect(mocks.query.retry).toBe(false)
    expect(mocks.menu.items.map(item => item.key)).toEqual(['view', 'download'])
    expect(mocks.menu.items[1].disabled).toBe(true)
    render('7', true)
    expect(mocks.query.queryKey).toEqual(['project-credential', '1', '7', true])
  })
  it('shows a retry for a failed request and does not display it as an unsubmitted credential', () => {
    mocks.result = { isPending: false, isFetching: false, isError: true, error: new Error('Request failed'), refetch: vi.fn() }
    const html = render()
    expect(html).toContain('Request failed')
    expect(html).toContain('Retry')
    expect(html).not.toContain('Not on chain')
    expect(mocks.menu.items[1].disabled).toBe(true)
  })
  it.each([true, false])('keeps network states separate and enforces download capability %s', canDownload => {
    mocks.result = { isPending: false, isFetching: false, isError: false, data: {
      releaseId: 'release', releaseHash: 'a'.repeat(64), manifest: { schema: 3, projectName: 'Publication name', version: '1.0', contentHash: 'b'.repeat(64) }, publishedAt: '2026-10-10T00:00:00Z', canDownload, downloadReason: canDownload ? 'ALLOWED' : 'DOWNLOAD_DISABLED',
      networks: [{ network: 'mainnet', status: null, transactionSignature: null, signerAddress: null, blockTime: null }, { network: 'devnet', status: 2, transactionSignature: 'signature', signerAddress: 'wallet', blockTime: null }],
    } }
    const html = render()
    expect(html).toContain('Publication name')
    expect(html).toContain('Not on chain')
    expect(html).toContain('On chain')
    expect(html).toContain('/evidence/signature')
    expect(html).toContain('?cluster=devnet')
    expect(mocks.menu.items[1].disabled).toBe(!canDownload)
    expect(html).not.toContain('/manifest')
  })
})
