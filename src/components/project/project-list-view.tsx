'use client'

/**
 * @file project-list-view.tsx
 * @project SlothVault
 * @module Public Project Library
 * @description Renders the responsive public project archive with a consistent metadata hierarchy and an optional filing footer.
 * @logic Present named project links, release summaries, aligned access rules, and localized metadata before the supplied footer.
 * @dependencies Ant Design, next-intl, PublicNavbar, public.module.css
 * @index_tags projects,public,library,filing,footer,responsive
 * @author holic512
 */
import type { ReactNode } from 'react'

import { Card, Empty } from 'antd'
import { ArrowUpRight, CalendarClock, FolderTree, GitBranch } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'

import { PublicNavbar } from '@/components/shell/public-navbar'
import publicStyles from '@/styles/modules/public.module.css'
import type { SystemBranding } from '@/types/branding'
import type { AccessRule, ReadAccessMode, DownloadAccessMode } from '@/lib/content-access'

export type ProjectListItem = {
  id: string
  projectName: string
  avatar: string | null
  latestVersion: string | null
  latestVersionDesc: string | null
  categoryCount: number
  updatedAt: string
  readAccess: AccessRule<ReadAccessMode>
  downloadAccess: AccessRule<DownloadAccessMode>
}

export function ProjectListView({
  projects,
  branding,
  footer,
}: {
  projects: ProjectListItem[]
  branding: SystemBranding
  footer?: ReactNode
}) {
  const locale = useLocale()
  const t = useTranslations('ProjectsPage')
  const permissionT = useTranslations('AdminMM.projects.permissions')
  const describe = (rule: AccessRule) => rule.mode === 'MEMBERSHIPS' ? rule.membershipLevels.map(item => item.name).join(' / ') : permissionT(`modes.${rule.mode}`)
  const dateLocale = locale === 'zh' ? 'zh-CN' : 'en-US'

  return (
    <div className={`${publicStyles.root} public-page projects-page`}>
      <PublicNavbar branding={branding} />
      <main className="projects-main content-container">
        <header className="public-list-heading">
          <div>
            <h1>{t('title')}</h1>
            <p>{t('description')}</p>
          </div>
          <span className="public-list-count">{t('count', { count: projects.length })}</span>
        </header>

        {projects.length ? (
          <div className="project-grid">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/project/${project.id}/home`}
                className="project-card-link"
                aria-labelledby={`project-title-${project.id}`}
              >
                <Card className="project-library-card" variant="borderless">
                  <div className="project-card-topline">
                    <span className="project-card-avatar" aria-hidden="true">
                      {project.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={project.avatar} alt="" />
                      ) : project.projectName.charAt(0)}
                    </span>
                    <span className="project-card-arrow" aria-hidden="true"><ArrowUpRight size={16} strokeWidth={1.5} /></span>
                  </div>
                  <h2 id={`project-title-${project.id}`} className="project-card-title">{project.projectName}</h2>
                  <p className="project-card-description">
                    {project.latestVersionDesc || t('fallbackDescription')}
                  </p>
                  <div className="project-card-details">
                    <div className="project-card-edition" data-state={project.latestVersion ? 'versioned' : 'unversioned'}>
                      <GitBranch size={16} strokeWidth={1.5} aria-hidden="true" />
                      <span>{project.latestVersion ? t('version', { version: project.latestVersion }) : t('unversioned')}</span>
                    </div>
                    <dl className="project-card-access">
                      <dt>{permissionT('read')}</dt>
                      <dd>{describe(project.readAccess)}</dd>
                      <dt>{permissionT('download')}</dt>
                      <dd>{describe(project.downloadAccess)}</dd>
                    </dl>
                  </div>
                  <div className="project-card-meta">
                    <span><FolderTree size={16} strokeWidth={1.5} aria-hidden="true" />{t('categories', { count: project.categoryCount })}</span>
                    <span>
                      <CalendarClock size={16} strokeWidth={1.5} aria-hidden="true" />
                      <time dateTime={project.updatedAt} aria-label={t('updatedAt', { date: new Date(project.updatedAt).toLocaleDateString(dateLocale) })}>
                        {new Date(project.updatedAt).toLocaleDateString(dateLocale)}
                      </time>
                    </span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Empty description={t('empty')} />
        )}
      </main>
      {footer}
    </div>
  )
}
