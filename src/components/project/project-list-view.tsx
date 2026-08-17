'use client'

import { Card, Empty, Typography } from 'antd'
import { ArrowUpRight, CalendarClock, FolderTree } from 'lucide-react'
import { useTranslations } from 'next-intl'
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
  const t = useTranslations('ProjectsPage')

  return (
    <div className={`${publicStyles.root} public-page projects-page`}>
      <PublicNavbar branding={branding} />
      <main className="projects-main content-container">
        <div className="projects-heading">
          <Typography.Text className="projects-kicker">Library</Typography.Text>
          <Typography.Title>{t('title')}</Typography.Title>
        </div>

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
                    {project.latestVersionDesc || 'A versioned SlothVault document collection.'}
                  </Typography.Paragraph>
                  <div className="project-card-edition">
                    {project.latestVersion ? `Edition ${project.latestVersion}` : 'Living collection'}
                  </div>
                  <div className="project-card-meta">
                    <span><FolderTree size={14} />{project.categoryCount} {t('categories')}</span>
                    <span><CalendarClock size={14} />{new Date(project.updatedAt).toLocaleDateString()}</span>
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
