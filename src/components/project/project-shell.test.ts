import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { createTranslator } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'

import en from '../../../messages/en.json'
import zh from '../../../messages/zh.json'

import { ProjectShell } from './project-shell'

const scenario = vi.hoisted(() => ({ locale: 'en', pathname: '/project/42/home' }))

vi.mock('next/navigation', () => ({
  usePathname: () => scenario.pathname,
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('next-intl', async (importOriginal) => ({
  ...await importOriginal<typeof import('next-intl')>(),
  useTranslations: (namespace: 'ProjectNavigation') => createTranslator({
    locale: scenario.locale,
    messages: scenario.locale === 'zh' ? zh : en,
    namespace,
  }),
}))

vi.mock('antd', async (importOriginal) => ({
  ...await importOriginal<typeof import('antd')>(),
  Drawer: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/components/shell/navigation-shell', () => ({
  NavigationShell: ({ links, actions }: { links: ReactNode; actions: ReactNode }) =>
    createElement('header', null, links, actions),
}))
vi.mock('@/components/auth/account-nav', () => ({ AccountNav: () => null }))
vi.mock('@/components/theme/theme-controls', () => ({ ThemeControls: () => null }))

function renderShell(previewBase?: string) {
  const props: Parameters<typeof ProjectShell>[0] = {
    previewBase,
    projectId: '42',
    project: { id: '42', projectName: 'Example', avatar: null, status: 1, updatedAt: '' },
    versions: previewBase ? [] : [{
      id: '8', version: '1.0', description: null, weight: 0, releaseId: 'release',
      releaseHash: 'hash', manifestVersion: 1, publishedAt: '',
    }],
    menus: previewBase ? [] : [{ id: '9', label: 'Community', url: 'https://example.com', isExternal: true, weight: 0, children: [] }],
    children: null,
  }
  return renderToStaticMarkup(createElement(ProjectShell, props))
}

describe('public project navigation rendering', () => {
  afterEach(() => {
    scenario.locale = 'en'
    scenario.pathname = '/project/42/home'
  })

  it.each([
    ['en', 'Home', 'Docs', 'Open project navigation', 'Back to project library'],
    ['zh', '首页', '文档', '打开项目导航', '返回项目列表'],
  ])('localizes desktop and mobile built-in entries in %s', (locale, home, docs, openMenu, library) => {
    scenario.locale = locale
    const html = renderShell()
    expect(html.match(new RegExp(`>${home}</a>`, 'g'))).toHaveLength(2)
    expect(html.match(new RegExp(`>${docs}</a>`, 'g'))).toHaveLength(2)
    expect(html).toContain(`aria-label="${openMenu}"`)
    expect(html).toContain(`aria-label="${library}"`)
    expect(html.match(/aria-current="page" href="\/project\/42\/home"/g)).toHaveLength(2)
    expect(html.match(/>Community<\/a>/g)).toHaveLength(2)
    expect(html.match(/target="_blank" rel="noreferrer"/g)).toHaveLength(2)
  })

  it('marks Docs as current in both layouts on a versioned note route', () => {
    scenario.pathname = '/project/42/v/8/docs/123'
    const html = renderShell()
    expect(html.match(/aria-current="page" href="\/project\/42\/docs"/g)).toHaveLength(2)
    expect(html.match(/aria-label="Select project version"/g)).toHaveLength(2)
  })
})

 it('pins desktop and mobile preview links to the selected version', () => {
   scenario.pathname = '/preview/project/42/v/8/docs/123'
   const html = renderShell('/preview/project/42/v/8')
   expect(html.match(/href="\/preview\/project\/42\/v\/8\/home"/g)).toHaveLength(2)
   expect(html.match(/aria-current="page" href="\/preview\/project\/42\/v\/8\/docs"/g)).toHaveLength(2)
   expect(html).not.toContain('Community')
   expect(html).not.toContain('Select project version')
 })
