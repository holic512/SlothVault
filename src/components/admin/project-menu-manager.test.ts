import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { App } from 'antd'
import { createTranslator } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'

import en from '../../../messages/en.json'
import zh from '../../../messages/zh.json'
import type { CustomProjectMenu } from '@/lib/project-navigation'

import { ProjectMenuManager } from './project-menu-manager'

const scenario = vi.hoisted(() => ({
  locale: 'en',
  data: [] as CustomProjectMenu[],
  isError: false,
  refetch: vi.fn(),
  retry: undefined as (() => void) | undefined,
}))

vi.mock('next-intl', async (importOriginal) => ({
  ...await importOriginal<typeof import('next-intl')>(),
  useTranslations: (namespace: 'AdminMM.projectMenu' | 'AdminMM.errors' | 'ProjectNavigation') => createTranslator({
    locale: scenario.locale,
    messages: scenario.locale === 'zh' ? zh : en,
    namespace,
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: scenario.data,
    isLoading: false,
    isFetching: false,
    isError: scenario.isError,
    error: new Error('Network error'),
    refetch: scenario.refetch,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>()
  return {
    ...actual,
    Modal: ({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null,
    Button: (props: Parameters<typeof actual.Button>[0]) => {
      if (props.children === 'Retry') scenario.retry = () => props.onClick?.({} as never)
      return createElement(actual.Button, props)
    },
  }
})

function renderManager() {
  vi.spyOn(App, 'useApp').mockReturnValue({ message: {}, modal: {} } as ReturnType<typeof App.useApp>)
  return renderToStaticMarkup(createElement(ProjectMenuManager, {
    project: { id: '42', projectName: 'Example' },
    onClose: vi.fn(),
  }))
}

describe('project navigation administration', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    scenario.locale = 'en'
    scenario.data = []
    scenario.isError = false
    scenario.retry = undefined
    scenario.refetch.mockClear()
  })

  it.each([
    ['en', 'Home', 'Docs', 'System built-in', 'Fixed entry, cannot be modified'],
    ['zh', '首页', '文档', '系统内置', '固定入口，不可修改'],
  ])('shows both read-only built-in rows with no custom menus in %s', (locale, home, docs, source, fixed) => {
    scenario.locale = locale
    const html = renderManager()
    const rows = html.match(/<tr\b[^>]*data-row-key="builtin:[^"]+"[^>]*>[\s\S]*?<\/tr>/g) || []
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain(home)
    expect(rows[1]).toContain(docs)
    for (const row of rows) {
      expect(row).toContain(source)
      expect(row).toContain(fixed)
      expect(row).not.toContain('<button')
    }
    expect(html).toContain('/project/42/home')
    expect(html).toContain('/project/42/docs')
  })

  it('preserves built-in rows on load failure and offers a working retry action', () => {
    scenario.isError = true
    const html = renderManager()
    expect(html).toContain('Failed to load custom navigation')
    expect(html).toContain('data-row-key="builtin:home"')
    expect(html).toContain('data-row-key="builtin:docs"')
    expect(scenario.retry).toBeTypeOf('function')
    scenario.retry?.()
    expect(scenario.refetch).toHaveBeenCalledOnce()
  })

  it('leaves custom navigation editable after the fixed entries', () => {
    scenario.data = [{
      id: '9', projectId: '42', parentId: null, label: 'Community', url: '/community',
      isExternal: false, weight: 0, status: 1, isDeleted: false, createdAt: '', updatedAt: '',
    }]
    const html = renderManager()
    const row = html.match(/<tr\b[^>]*data-row-key="custom:9"[^>]*>[\s\S]*?<\/tr>/)?.[0] || ''
    expect(row).toContain('Community')
    expect(row).toContain('Custom')
    expect(row).toContain('Add child')
    expect(row).toContain('Edit')
    expect(row).toContain('Delete')
    expect(html.indexOf('data-row-key="custom:9"')).toBeGreaterThan(html.indexOf('data-row-key="builtin:docs"'))
  })
})
