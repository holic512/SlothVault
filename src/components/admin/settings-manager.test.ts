import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { createTranslator } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'

import en from '../../../messages/en.json'
import zh from '../../../messages/zh.json'
import type { SettingsSectionKey } from '@/lib/admin-settings-draft'

import { SettingsNavigation } from './settings-manager'
import { RpcSettingsField } from './rpc-settings-field'

const scenario = vi.hoisted(() => ({ locale: 'en' }))

vi.mock('next-intl', async (importOriginal) => ({
  ...await importOriginal<typeof import('next-intl')>(),
  useLocale: () => scenario.locale,
  useTranslations: (namespace: 'AdminMM.settings' | 'AdminMM.errors') => createTranslator({
    locale: scenario.locale,
    messages: scenario.locale === 'zh' ? zh : en,
    namespace,
  }),
}))

function renderNavigation(activeSection: string | null, dirty: SettingsSectionKey[] = []) {
  return renderToStaticMarkup(createElement(SettingsNavigation, { activeSection, dirtySections: new Set(dirty) }))
}

describe('settings route navigation', () => {
  afterEach(() => { scenario.locale = 'en' })

  it.each(['branding', 'filing', 'policy', 'rpc', 'updates'])('selects only the current %s destination', (section) => {
    const html = renderNavigation(section)
    const links = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) || []
    expect(links).toHaveLength(5)
    const active = links.filter((link) => link.includes('aria-current="page"'))
    expect(active).toHaveLength(1)
    expect(active[0]).toContain(`href="/admin/mm/settings/${section}"`)
    expect(active[0]).toContain('is-active')
    expect(html).not.toContain('settings-tab-dirty-dot')
  })

  it.each([
    ['en', 'Filing Information: Unsaved changes', 'RPC Nodes: Unsaved changes'],
    ['zh', '备案信息: 有未保存的更改', 'RPC 节点: 有未保存的更改'],
  ])('labels dirty pages accessibly in %s, including the active page', (locale, filing, rpc) => {
    scenario.locale = locale
    const html = renderNavigation('filing', ['filing', 'rpc'])
    expect(html).toContain(`aria-label="${filing}"`)
    expect(html).toContain(`title="${rpc}"`)
    expect(html.match(/class="settings-tab-dirty-dot" aria-hidden="true"/g)).toHaveLength(2)
    const updateLink = (html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) || []).find((link) => link.includes('/settings/updates'))
    expect(updateLink).not.toContain('settings-tab-dirty-dot')
  })

  it('does not highlight another destination for an unknown route', () => {
    expect(renderNavigation('unknown')).not.toContain('aria-current="page"')
    expect(renderNavigation(null)).not.toContain('aria-current="page"')
  })
})

describe('RPC settings fields', () => {
  const endpoint = 'https://rpc.example.test/path?key=example'
  const key = 'SOLANA_MAINNET_RPC_PRIMARY' as const
  const props = {
    config: { key, value: endpoint, effectiveValue: endpoint, description: '', defaultValue: '', sensitive: false },
    value: endpoint, dirty: false, locked: false, testingDisabled: false, onChange: vi.fn(), onTest: vi.fn(),
  }
  it('renders a readable ordinary input with a meaningful label and an independent test control', () => {
    const html = renderToStaticMarkup(createElement(RpcSettingsField, props))
    expect(html).toContain('type="text"')
    expect(html).toContain(`value="${endpoint}"`)
    expect(html).toContain('aria-label="Test Mainnet primary"')
    expect(html).toContain('Not tested')
    expect(html).not.toContain('type="password"')
  })

  it('replaces obsolete results with a save-first message and disables dirty-node testing', () => {
    const html = renderToStaticMarkup(createElement(RpcSettingsField, { ...props, dirty: true, state: {
      endpoint, pending: false, error: null,
      result: { key, endpoint, status: 'success', latencyMs: 15, testedAt: '2026-10-10T09:00:00Z', errorCode: null, httpStatus: null },
    } }))
    expect(html).toContain('Save node changes before testing')
    expect(html).not.toContain('15 ms')
    expect(html).toMatch(/<button[^>]*disabled=""/)
  })

  it.each(['en', 'zh'])('shows node latency and timeout in %s', (locale) => {
    scenario.locale = locale
    const state = { endpoint, pending: false, error: null, result: {
      key, endpoint, status: 'success' as const, latencyMs: 15, testedAt: '2026-10-10T09:00:00Z', errorCode: null, httpStatus: null,
    } }
    expect(renderToStaticMarkup(createElement(RpcSettingsField, { ...props, state }))).toContain('15 ms')
    expect(renderToStaticMarkup(createElement(RpcSettingsField, { ...props, state: { ...state, result: { ...state.result, status: 'timeout' } } })))
      .toContain(locale === 'zh' ? '超时 · 8 秒' : 'Timeout · 8 seconds')
    scenario.locale = 'en'
  })
})
