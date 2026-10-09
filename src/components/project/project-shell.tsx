'use client'

/**
 * @file project-shell.tsx
 * @project SlothVault
 * @module Public Project Shell
 * @description Provides the public article-collection layout and interactive navigation around server-rendered reading routes.
 * @logic Render localized navigation and server-rendered reading content with an optional filing footer, and handle version switching and mobile menus.
 * @dependencies Ant Design, Next navigation, next-intl, project context, navigation-shell, project-navigation
 * @index_tags project-layout,public-reading,navigation,server-data,web2
 * @author holic512
 */
import { useState, type ReactNode } from 'react'

import { Button, Drawer, Dropdown, Select } from 'antd'
import { ChevronDown, Library, Menu } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import {
  type ProjectMenu,
  type ProjectVersion,
  type PublicProject,
} from '@/components/project/project-context'
import { NavigationShell } from '@/components/shell/navigation-shell'
import { ThemeControls } from '@/components/theme/theme-controls'
import { AccountNav } from '@/components/auth/account-nav'
import projectStyles from '@/styles/modules/project.module.css'
import { contextualFileUrl, managedUploadPath } from '@/lib/managed-file-paths'
import { getBuiltinProjectNavigation, isBuiltinProjectNavigationActive } from '@/lib/project-navigation'

export function ProjectShell({
  projectId,
  project,
  versions,
  menus,
  children,
  footer,
}: {
  projectId: string
  project: PublicProject
  versions: ProjectVersion[]
  menus: ProjectMenu[]
  children: ReactNode
  footer?: ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()

  return (
    <div className={`${projectStyles.root} project-page`}>
      <ProjectNavigation
        project={project}
        projectId={projectId}
        versions={versions}
        menus={menus}
        pathname={pathname}
        onVersionChange={(value) => router.push(`/project/${projectId}/v/${value}/docs`)}
      />
      {children}
      {footer}
    </div>
  )
}

function ProjectNavigation({
  project,
  projectId,
  versions,
  menus,
  pathname,
  onVersionChange,
}: {
  project: PublicProject
  projectId: string
  versions: ProjectVersion[]
  menus: ProjectMenu[]
  pathname: string
  onVersionChange: (value: string) => void
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const t = useTranslations('ProjectNavigation')
  const builtinLinks = getBuiltinProjectNavigation(projectId)
  const docsActive = isBuiltinProjectNavigationActive('docs', projectId, pathname)
  const versionMatch = pathname.match(/\/v\/([^/]+)/)
  const currentVersion = versionMatch?.[1]
  const resolveUrl = (url: string | null) => {
    if (!url) return `/project/${projectId}/home`
    if (managedUploadPath(url)) return contextualFileUrl(url, projectId, true)!
    return url.startsWith('/') ? `/project/${projectId}${url}` : url
  }

  return (
    <>
      <NavigationShell
        kind="project"
        brand={
          <Link href={`/project/${projectId}/home`} className="project-brand-lockup">
            {project.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={project.avatar} alt="" />
            ) : (
              <span>{project.projectName.charAt(0)}</span>
            )}
            <strong>{project.projectName}</strong>
          </Link>
        }
        links={
          <>
            {builtinLinks.map((entry) => {
              const active = isBuiltinProjectNavigationActive(entry.key, projectId, pathname)
              return (
                <Link key={entry.key} className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined} href={entry.href}>
                  {t(entry.translationKey)}
                </Link>
              )
            })}
            {menus.map((menu) =>
              menu.children.length ? (
                <Dropdown
                  key={menu.id}
                  menu={{
                    items: menu.children.map((child) => ({
                      key: child.id,
                      label: child.isExternal ? (
                        <a href={contextualFileUrl(child.url ?? undefined, projectId, true) || '#'} target="_blank" rel="noreferrer">{child.label}</a>
                      ) : (
                        <Link href={resolveUrl(child.url)}>{child.label}</Link>
                      ),
                    })),
                  }}
                >
                  <Button type="text">{menu.label}<ChevronDown size={13} /></Button>
                </Dropdown>
              ) : menu.isExternal ? (
                <a key={menu.id} href={contextualFileUrl(menu.url ?? undefined, projectId, true) || '#'} target="_blank" rel="noreferrer">{menu.label}</a>
              ) : (
                <Link key={menu.id} href={resolveUrl(menu.url)}>{menu.label}</Link>
              ),
            )}
          </>
        }
        actions={
          <>
            {docsActive && versions.length ? (
              <Select
                className="project-version-select"
                aria-label={t('version')}
                value={currentVersion || versions[0]?.id}
                options={versions.map((version) => ({ label: version.version, value: version.id }))}
                onChange={onVersionChange}
                suffixIcon={<ChevronDown size={13} />}
              />
            ) : null}
            <Button className="project-nav-library" aria-label={t('library')} icon={<Library size={16} />} href="/project/projectList" />
            <AccountNav compact />
            <ThemeControls />
            <Button
              className="navigation-menu project-nav-menu"
              aria-label={t('openMenu')}
              icon={<Menu size={17} />}
              onClick={() => setMobileOpen(true)}
            />
          </>
        }
      />
      <Drawer
        className="mobile-nav-drawer project-mobile-drawer"
        title={project.projectName}
        placement="right"
        size={340}
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
      >
        <nav className="mobile-nav-links" aria-label={t('mobileNavigation')}>
          {builtinLinks.map((entry) => {
            const active = isBuiltinProjectNavigationActive(entry.key, projectId, pathname)
            return (
              <Link key={entry.key} className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined} href={entry.href} onClick={() => setMobileOpen(false)}>
                {t(entry.translationKey)}
              </Link>
            )
          })}
          {docsActive && versions.length ? (
            <Select
              className="project-mobile-version-select"
              aria-label={t('version')}
              value={currentVersion || versions[0]?.id}
              options={versions.map((version) => ({ label: version.version, value: version.id }))}
              onChange={(value) => {
                onVersionChange(value)
                setMobileOpen(false)
              }}
              suffixIcon={<ChevronDown size={13} />}
            />
          ) : null}
          {menus.flatMap((menu) =>
            menu.children.length
              ? menu.children.map((child) =>
                  child.isExternal ? (
                    <a key={child.id} href={contextualFileUrl(child.url ?? undefined, projectId, true) || '#'} target="_blank" rel="noreferrer" onClick={() => setMobileOpen(false)}>
                      {child.label}
                    </a>
                  ) : (
                    <Link key={child.id} href={resolveUrl(child.url)} onClick={() => setMobileOpen(false)}>
                      {child.label}
                    </Link>
                  ),
                )
              : menu.isExternal
                ? [
                    <a key={menu.id} href={contextualFileUrl(menu.url ?? undefined, projectId, true) || '#'} target="_blank" rel="noreferrer" onClick={() => setMobileOpen(false)}>
                      {menu.label}
                    </a>,
                  ]
                : [
                    <Link key={menu.id} href={resolveUrl(menu.url)} onClick={() => setMobileOpen(false)}>
                      {menu.label}
                    </Link>,
                  ],
          )}
        </nav>
      </Drawer>
    </>
  )
}
