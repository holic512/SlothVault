/**
 * @file project-navigation.ts
 * @project SlothVault
 * @module Project Navigation
 * @description Shares fixed project destinations and typed admin display rows.
 * @logic Resolve built-in links and active routes, then prepend read-only entries to custom menu trees.
 * @dependencies None
 * @index_tags project,navigation,built-in,admin,i18n
 * @author holic512
 */
export const builtinProjectNavigation = [
  { key: 'home', path: '/home', translationKey: 'home' },
  { key: 'docs', path: '/docs', translationKey: 'docs' },
] as const

export type BuiltinProjectNavigationKey = typeof builtinProjectNavigation[number]['key']

export function getBuiltinProjectNavigation(projectId: string) {
  return builtinProjectNavigation.map((entry) => ({
    ...entry,
    href: `/project/${projectId}${entry.path}`,
  }))
}

export function isBuiltinProjectNavigationActive(
  key: BuiltinProjectNavigationKey,
  projectId: string,
  pathname: string,
) {
  const base = `/project/${projectId}`
  if (key === 'home') return pathname === `${base}/home`
  if (pathname === `${base}/docs` || pathname.startsWith(`${base}/docs/`)) return true
  if (!pathname.startsWith(`${base}/v/`)) return false
  return /^[^/]+\/docs(?:\/.*)?$/.test(pathname.slice(`${base}/v/`.length))
}

export type CustomProjectMenu = {
  id: string
  projectId: string
  parentId: string | null
  label: string
  url: string | null
  isExternal: boolean
  weight: number
  status: number
  createdAt: string
  updatedAt: string
  isDeleted: boolean
  children?: CustomProjectMenu[]
}

export type ProjectMenuRow = {
  kind: 'builtin'
  rowKey: string
  label: string
  url: string
  isExternal: false
  status: 1
  isDeleted: false
} | (Omit<CustomProjectMenu, 'children'> & {
  kind: 'custom'
  rowKey: string
  menu: CustomProjectMenu
  children?: ProjectMenuRow[]
})

export function buildProjectMenuRows(
  projectId: string,
  menus: CustomProjectMenu[],
  translate: (key: BuiltinProjectNavigationKey) => string,
): ProjectMenuRow[] {
  const customRow = (menu: CustomProjectMenu): ProjectMenuRow => ({
    ...menu,
    kind: 'custom',
    rowKey: `custom:${menu.id}`,
    menu,
    children: menu.children?.length ? menu.children.map(customRow) : undefined,
  })
  return [
    ...getBuiltinProjectNavigation(projectId).map((entry): ProjectMenuRow => ({
      kind: 'builtin',
      rowKey: `builtin:${entry.key}`,
      label: translate(entry.translationKey),
      url: entry.href,
      isExternal: false,
      status: 1,
      isDeleted: false,
    })),
    ...menus.map(customRow),
  ]
}
