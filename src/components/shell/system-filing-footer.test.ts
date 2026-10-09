import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import zh from '../../../messages/zh.json'
import type { SystemFiling } from '@/server/services/system-filing'

const mocks = vi.hoisted(() => ({ getSystemFiling: vi.fn() }))
vi.mock('@/server/services/system-filing', () => ({ getSystemFiling: mocks.getSystemFiling }))
vi.mock('next-intl/server', () => ({
  getTranslations: async () => createTranslator({ locale: 'zh', messages: zh, namespace: 'SystemFiling' }),
}))

import { SystemFilingFooter } from './system-filing-footer'

async function renderFooter(filing: SystemFiling) {
  mocks.getSystemFiling.mockResolvedValue(filing)
  return renderToStaticMarkup(await SystemFilingFooter())
}

describe('system filing footer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders no element or placeholder when both numbers are absent', async () => {
    expect(await renderFooter({ icp: null, publicSecurity: null })).toBe('')
  })

  it('renders ICP alone as plain text without public security labels or links', async () => {
    const html = await renderFooter({ icp: { number: '测试ICP备12345678号-1', url: '' }, publicSecurity: null })
    expect(html).toContain('data-system-filing-footer="true"')
    expect(html).toContain('测试ICP备12345678号-1')
    expect(html).not.toContain('公安备案')
    expect(html).not.toContain('<a ')
  })

  it('renders each configured number as its own safe external link', async () => {
    const html = await renderFooter({
      icp: { number: '测试ICP备12345678号-1', url: 'https://example.com/icp' },
      publicSecurity: { number: '测试公网安备12345678901234号', url: 'http://example.com/security' },
    })
    expect(html).toContain('href="https://example.com/icp"')
    expect(html).toContain('href="http://example.com/security"')
    expect(html.match(/target="_blank" rel="noopener noreferrer"/g)).toHaveLength(2)
    expect(html.match(/<footer /g)).toHaveLength(1)
  })

  it('escapes stored markup instead of interpreting filing numbers as HTML', async () => {
    const html = await renderFooter({ icp: null, publicSecurity: { number: '<img src=x onerror=alert(1)>', url: '' } })
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
  })
})
