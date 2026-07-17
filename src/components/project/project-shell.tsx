'use client'

/**
 * @file project-shell.tsx
 * @project SlothVault
 * @module Public Project Shell
 * @description Replaces the Nuxt project layout with a React navigation, signed access gate, and shared project data boundary.
 * @logic Load public metadata first, verify protected access, then fetch versions/menus and render nested reading routes.
 * @dependencies React Query, Ant Design, Next navigation, wallet access hook, project context
 * @index_tags project-layout,access-gate,navigation,react-query
 * @author holic512
 */
import type { ReactNode } from 'react'

import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Dropdown, Select, Skeleton, Space } from 'antd'
import { ChevronDown, Library, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

import { ProjectAccessGate } from '@/components/project/project-access-gate'
import {
  ProjectContextProvider,
  type ProjectMenu,
  type ProjectVersion,
  type PublicProject,
} from '@/components/project/project-context'
import { ThemeControls } from '@/components/theme/theme-controls'
import { WalletButton } from '@/components/wallet/wallet-button'
import { useProjectAccess } from '@/hooks/use-project-access'
import { apiFetch } from '@/lib/api-client'

export function ProjectShell({ projectId, children }: { projectId: string; children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const projectQuery = useQuery({
    queryKey: ['public-project', projectId],
    queryFn: () => apiFetch<PublicProject>(`/api/project/${projectId}`),
  })
  const access = useProjectAccess(projectId, projectQuery.data?.requireAuth)
  const versionsQuery = useQuery({
    queryKey: ['public-project-versions', projectId, access.publicKey],
    enabled: Boolean(projectQuery.data && access.hasAccess),
    queryFn: () =>
      apiFetch<ProjectVersion[]>(`/api/project/${projectId}/versions`, {
        headers: access.headers,
      }),
  })
  const menuQuery = useQuery({
    queryKey: ['public-project-menu', projectId, access.publicKey],
    enabled: Boolean(projectQuery.data && access.hasAccess),
    queryFn: () =>
      apiFetch<ProjectMenu[]>(`/api/project/${projectId}/menu`, {
        headers: access.headers,
      }),
  })

  if (projectQuery.isLoading) {
    return <div className="project-shell-loading"><Skeleton active paragraph={{ rows: 8 }} /></div>
  }
  if (projectQuery.isError || !projectQuery.data) {
    return (
      <div className="project-shell-loading">
        <Alert type="error" showIcon message="Project unavailable" description={projectQuery.error?.message} />
      </div>
    )
  }
  if (!access.hasAccess) {
    return (
      <div className="project-page">
        <ProjectNavigation
          project={projectQuery.data}
          projectId={projectId}
          versions={[]}
          menus={[]}
          pathname={pathname}
          onVersionChange={(value) => router.push(`/project/${projectId}/v/${value}/docs`)}
        />
        <ProjectAccessGate
          loading={access.loading}
          connected={access.connected}
          reason={access.reason}
          onAuthorize={access.authorize}
        />
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
        accessHeaders: access.headers,
      }}
    >
      <div className="project-page">
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
          {project.requireAuth ? <ShieldCheck size={14} /> : null}
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
          <WalletButton />
          <ThemeControls />
        </Space>
      </nav>
    </header>
  )
}
