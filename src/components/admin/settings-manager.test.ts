import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { createTranslator } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'

import en from '../../../messages/en.json'
import zh from '../../../messages/zh.json'
import type { SettingsSectionKey } from '@/lib/admin-settings-draft'

import { SettingsNavigation } from './settings-manager'

const scenario = vi.hoisted(() => ({ locale: 'en' }))

vi.mock('next-intl', async (importOriginal) => ({
  ...await importOriginal<typeof import('next-intl')>(),
  useTranslations: () => createTranslator({
    locale: scenario.locale,
    messages: scenario.locale === 'zh' ? zh : en,
    namespace: 'AdminMM.settings',
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
