import { describe, expect, it } from 'vitest'

import {
  buildProjectMenuRows,
  getBuiltinProjectNavigation,
  isBuiltinProjectNavigationActive,
  type CustomProjectMenu,
} from './project-navigation'

const customMenu: CustomProjectMenu = {
  id: 'home',
  projectId: '42',
  parentId: null,
  label: 'Community',
  url: 'https://example.com',
  isExternal: true,
  weight: 10,
  status: 1,
  createdAt: '2026-09-30T00:00:00Z',
  updatedAt: '2026-09-30T00:00:00Z',
  isDeleted: false,
}

describe('project navigation', () => {
  it('resolves fixed destinations in order for the current project', () => {
    expect(getBuiltinProjectNavigation('42')).toEqual([
      { key: 'home', path: '/home', translationKey: 'home', href: '/project/42/home' },
      { key: 'docs', path: '/docs', translationKey: 'docs', href: '/project/42/docs' },
    ])
    expect(getBuiltinProjectNavigation('7')[0].href).toBe('/project/7/home')
  })

  it.each([
    ['/project/42/home', true, false],
    ['/project/42/docs', false, true],
    ['/project/42/docs/123', false, true],
    ['/project/42/v/8/docs', false, true],
    ['/project/42/v/8/docs/123', false, true],
    ['/project/42/community/home', false, false],
    ['/project/42/docs-extra', false, false],
    ['/project/42/v/8/docs-extra', false, false],
    ['/project/42/v/8/other/docs', false, false],
    ['/project/42/v//docs', false, false],
    ['/project/420/docs', false, false],
    ['/project/7/home', false, false],
    ['/project/7/v/8/docs', false, false],
  ])('matches only the intended destinations at %s', (pathname, home, docs) => {
    expect(isBuiltinProjectNavigationActive('home', '42', pathname)).toBe(home)
    expect(isBuiltinProjectNavigationActive('docs', '42', pathname)).toBe(docs)
  })

  it('keeps built-in entries visible without custom data or database IDs', () => {
    const rows = buildProjectMenuRows('42', [], (key) => key === 'home' ? '首页' : '文档')
    expect(rows.map((row) => row.label)).toEqual(['首页', '文档'])
    expect(rows.map((row) => row.url)).toEqual(['/project/42/home', '/project/42/docs'])
    for (const row of rows) {
      expect(row.kind).toBe('builtin')
      expect(row.status).toBe(1)
      expect(row).not.toHaveProperty('id')
      expect(row).not.toHaveProperty('parentId')
      expect(row).not.toHaveProperty('menu')
    }
  })

  it('preserves custom tree order, labels and CRUD data without key collisions', () => {
    const child = { ...customMenu, id: 'docs', parentId: customMenu.id, label: '原始名称' }
    const root = { ...customMenu, children: [child] }
    const rows = buildProjectMenuRows('42', [root, { ...customMenu, id: 'second' }], (key) => key)
    expect(rows.map((row) => row.rowKey)).toEqual([
      'builtin:home', 'builtin:docs', 'custom:home', 'custom:second',
    ])
    const custom = rows[2]
    expect(custom.kind).toBe('custom')
    if (custom.kind !== 'custom') throw new Error('Expected custom menu')
    expect(custom.menu).toBe(root)
    expect(custom.children?.[0]).toMatchObject({ kind: 'custom', rowKey: 'custom:docs', label: '原始名称' })
    expect(root.children).toEqual([child])
  })
})
