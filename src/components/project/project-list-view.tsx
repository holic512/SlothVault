'use client'

import { Card, Empty, Typography } from 'antd'
import { ArrowUpRight, CalendarClock, FolderTree, GitBranch } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'

import { PublicNavbar } from '@/components/shell/public-navbar'
import publicStyles from '@/styles/modules/public.module.css'
import type { SystemBranding } from '@/types/branding'

export type ProjectListItem = {
  id: string
  projectName: string
  avatar: string | null
  latestVersion: string | null
  latestVersionDesc: string | null
  categoryCount: number
  updatedAt: string
}

export function ProjectListView({
  projects,
  branding,
}: {
  projects: ProjectListItem[]
  branding: SystemBranding
}) {
  const locale = useLocale()
  const t = useTranslations('ProjectsPage')
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
              <Link key={project.id} href={`/project/${project.id}/home`} className="project-card-link">
                <Card className="project-library-card" variant="borderless">
                  <div className="project-card-topline">
                    <span className="project-card-avatar">
                      {project.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={project.avatar} alt="" />
                      ) : project.projectName.charAt(0)}
                    </span>
                    <span className="project-card-arrow"><ArrowUpRight size={17} /></span>
                  </div>
                  <Typography.Title level={3}>{project.projectName}</Typography.Title>
                  <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }}>
                    {project.latestVersionDesc || t('fallbackDescription')}
                  </Typography.Paragraph>
                  <div className="project-card-edition" data-state={project.latestVersion ? 'versioned' : 'unversioned'}>
                    <GitBranch size={13} aria-hidden="true" />
                    {project.latestVersion ? t('version', { version: project.latestVersion }) : t('unversioned')}
                  </div>
                  <div className="project-card-meta">
                    <span className="project-card-categories" data-empty={project.categoryCount === 0}><FolderTree size={14} aria-hidden="true" />{project.categoryCount} {t('categories')}</span>
                    <span className="project-card-updated"><CalendarClock size={14} aria-hidden="true" />{new Date(project.updatedAt).toLocaleDateString(dateLocale)}</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Empty description={t('empty')} />
        )}
      </main>
    </div>
  )
}
