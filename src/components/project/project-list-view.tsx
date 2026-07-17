'use client'

import { useQuery } from '@tanstack/react-query'
import { Alert, Card, Empty, Skeleton, Tag, Typography } from 'antd'
import { ArrowUpRight, CalendarClock, FolderTree, LockKeyhole } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { PublicNavbar } from '@/components/shell/public-navbar'
import { apiFetch } from '@/lib/api-client'

type ProjectListItem = {
  id: string
  projectName: string
  avatar: string | null
  latestVersion: string | null
  latestVersionDesc: string | null
  categoryCount: number
  requireAuth: boolean
  updatedAt: string
}

export function ProjectListView() {
  const t = useTranslations('ProjectsPage')
  const query = useQuery({
    queryKey: ['public-project-list'],
    queryFn: () => apiFetch<ProjectListItem[]>('/api/project/list'),
  })

  return (
    <div className="public-page projects-page">
      <PublicNavbar />
      <main className="projects-main content-container">
        <div className="projects-heading">
          <Typography.Text className="projects-kicker">SlothVault / Library</Typography.Text>
          <Typography.Title>{t('title')}</Typography.Title>
          <Typography.Paragraph type="secondary">{t('desc')}</Typography.Paragraph>
        </div>

        {query.isLoading ? (
          <div className="project-grid">
            {Array.from({ length: 6 }, (_, index) => <Card key={index}><Skeleton active /></Card>)}
          </div>
        ) : query.isError ? (
          <Alert type="error" showIcon message={t('error')} description={query.error.message} />
        ) : query.data?.length ? (
          <div className="project-grid">
            {query.data.map((project) => (
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
                  <div className="project-card-tags">
                    {project.latestVersion ? <Tag>{project.latestVersion}</Tag> : null}
                    {project.requireAuth ? <Tag icon={<LockKeyhole size={12} />} color="purple">{t('requireAuth')}</Tag> : null}
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
