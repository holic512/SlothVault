'use client'

/**
 * @file project-shell.tsx
 * @project SlothVault
 * @module Public Project Shell
 * @description Provides the public article-collection layout, navigation, and shared project data boundary.
 * @logic Load published metadata, versions, and menus without identity gates, then render the nested reading routes.
 * @dependencies React Query, Ant Design, Next navigation, project context
 * @index_tags project-layout,public-reading,navigation,react-query,web2
 * @author holic512
 */
import { useState, type ReactNode } from 'react'

import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Drawer, Dropdown, Select, Skeleton, Space } from 'antd'
import { ChevronDown, Library, Menu } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

import {
  ProjectContextProvider,
  type ProjectMenu,
  type ProjectVersion,
  type PublicProject,
} from '@/components/project/project-context'
import { ThemeControls } from '@/components/theme/theme-controls'
import { AccountNav } from '@/components/auth/account-nav'
import { apiFetch } from '@/lib/api-client'
import projectStyles from '@/styles/modules/project.module.css'

export function ProjectShell({ projectId, children }: { projectId: string; children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const projectQuery = useQuery({
    queryKey: ['public-project', projectId],
    queryFn: () => apiFetch<PublicProject>(`/api/project/${projectId}`),
  })
  const versionsQuery = useQuery({
    queryKey: ['public-project-versions', projectId],
    enabled: Boolean(projectQuery.data),
    queryFn: () => apiFetch<ProjectVersion[]>(`/api/project/${projectId}/versions`),
  })
  const menuQuery = useQuery({
    queryKey: ['public-project-menu', projectId],
    enabled: Boolean(projectQuery.data),
    queryFn: () => apiFetch<ProjectMenu[]>(`/api/project/${projectId}/menu`),
  })

  if (projectQuery.isLoading) {
    return <div className={projectStyles.root}><div className="project-shell-loading"><Skeleton active paragraph={{ rows: 8 }} /></div></div>
  }
  if (projectQuery.isError || !projectQuery.data) {
    return (
      <div className={projectStyles.root}>
        <div className="project-shell-loading">
          <Alert type="error" showIcon message="Project unavailable" description={projectQuery.error?.message} />
        </div>
      </div>
    )
  }
  const versions = versionsQuery.data || []
  const menus = menuQuery.data || []
  return (
    <ProjectContextProvider
      value={{
        projectId,
        project: projectQuery.data,
        versions,
        menus,
      }}
    >
      <div className={`${projectStyles.root} project-page`}>
        <ProjectNavigation
          project={projectQuery.data}
          projectId={projectId}
          versions={versions}
          menus={menus}
          pathname={pathname}
          onVersionChange={(value) => router.push(`/project/${projectId}/v/${value}/docs`)}
        />
        {children}
      </div>
    </ProjectContextProvider>
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
  const versionMatch = pathname.match(/\/v\/([^/]+)/)
  const currentVersion = versionMatch?.[1]
  const resolveUrl = (url: string | null) => {
    if (!url) return `/project/${projectId}/home`
    return url.startsWith('/') ? `/project/${projectId}${url}` : url
  }

  return (
    <header className="project-nav-wrap">
      <nav className="project-nav">
        <Link href={`/project/${projectId}/home`} className="project-brand-lockup">
          {project.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={project.avatar} alt="" />
          ) : (
            <span>{project.projectName.charAt(0)}</span>
          )}
          <strong>{project.projectName}</strong>
        </Link>

        <div className="project-nav-center">
          <Link className={pathname.endsWith('/home') ? 'is-active' : ''} href={`/project/${projectId}/home`}>
            Home
          </Link>
          <Link className={pathname.includes('/docs') ? 'is-active' : ''} href={`/project/${projectId}/docs`}>
            Docs
          </Link>
          {menus.map((menu) =>
            menu.children.length ? (
              <Dropdown
                key={menu.id}
                menu={{
                  items: menu.children.map((child) => ({
                    key: child.id,
                    label: child.isExternal ? (
                      <a href={child.url || '#'} target="_blank" rel="noreferrer">{child.label}</a>
                    ) : (
                      <Link href={resolveUrl(child.url)}>{child.label}</Link>
                    ),
                  })),
                }}
              >
                <Button type="text">{menu.label}<ChevronDown size={13} /></Button>
              </Dropdown>
            ) : menu.isExternal ? (
              <a key={menu.id} href={menu.url || '#'} target="_blank" rel="noreferrer">{menu.label}</a>
            ) : (
              <Link key={menu.id} href={resolveUrl(menu.url)}>{menu.label}</Link>
            ),
          )}
        </div>

        <Space size={7} className="project-nav-actions">
          {pathname.includes('/docs') && versions.length ? (
            <Select
              className="project-version-select"
              value={currentVersion || versions[0]?.id}
              options={versions.map((version) => ({ label: version.version, value: version.id }))}
              onChange={onVersionChange}
              suffixIcon={<ChevronDown size={13} />}
            />
          ) : null}
          <Button icon={<Library size={16} />} href="/project/projectList" />
          <AccountNav compact />
          <ThemeControls />
          <Button
            className="project-nav-menu"
            aria-label="Open project navigation"
            icon={<Menu size={17} />}
            onClick={() => setMobileOpen(true)}
          />
        </Space>
      </nav>
      <Drawer
        className="mobile-nav-drawer project-mobile-drawer"
        title={project.projectName}
        placement="right"
        size={340}
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
      >
        <nav className="mobile-nav-links" aria-label="Project navigation">
          <Link href={`/project/${projectId}/home`} onClick={() => setMobileOpen(false)}>
            Home
          </Link>
          <Link href={`/project/${projectId}/docs`} onClick={() => setMobileOpen(false)}>
            Docs
          </Link>
          {pathname.includes('/docs') && versions.length ? (
            <Select
              className="project-mobile-version-select"
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
                    <a key={child.id} href={child.url || '#'} target="_blank" rel="noreferrer">
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
                    <a key={menu.id} href={menu.url || '#'} target="_blank" rel="noreferrer">
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
    </header>
  )
}
