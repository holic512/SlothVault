'use client'

import { Alert, Button, Card, Col, Progress, Row, Space, Statistic, Table, Typography } from 'antd'
import { ArchiveRestore, Blocks, BookOpenText, Coins, FileStack, FolderTree, Newspaper, RefreshCw, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'

import { AdminPage, AdminPageActions } from '@/components/admin/admin-page'
import { apiFetch } from '@/lib/api-client'

type DashboardData = {
  overview: {
    users: { total: number; activeSessions: number; totalPoints: number }
    giftCards: { total: number; redeemed: number }
    articles: { total: number; published: number }
    projects: { total: number; active: number }
    versions: { total: number; active: number }
    categories: { total: number; active: number }
    notes: { total: number; active: number }
    files: { total: number; totalSizeMB: string }
    blockchain: {
      evidence: { total: number; finalized: number; failed: number; pending: number }
    }
  }
  health: Record<string, number>
  recentActivity: {
    projects: Array<{
      id: string
      name: string
      status: number
      versionCount: number
      createdAt: string
    }>
    articles: Array<{
      id: string
      title: string
      status: number
      publishedAt: string | null
      updatedAt: string
    }>
    notes: Array<{
      id: string
      title: string
      status: number
      project: string
      version: string
      category: string
      createdAt: string
    }>
  }
}

export function DashboardView() {
  const t = useTranslations('AdminMM.dashboard')
  const query = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => apiFetch<DashboardData>('/api/admin/mm/dashboard'),
  })

  if (query.isError) {
    return (
      <AdminPage>
        <Alert
          type="error"
          showIcon
          message={t('messages.loadFailed')}
          description={query.error.message}
          action={<Button onClick={() => void query.refetch()}>{t('actions.refresh')}</Button>}
        />
      </AdminPage>
    )
  }

  const data = query.data
  const stats = data
    ? [
        { title: t('stats.projects'), value: data.overview.projects.total, meta: `${data.overview.projects.active} ${t('stats.active')}`, icon: <Blocks /> },
        { title: t('stats.articles'), value: data.overview.articles.total, meta: `${data.overview.articles.published} ${t('stats.published')}`, icon: <Newspaper /> },
        { title: 'Users', value: data.overview.users.total, meta: `${data.overview.users.activeSessions} active sessions`, icon: <Users /> },
        { title: 'Points', value: data.overview.users.totalPoints, meta: `${data.overview.giftCards.redeemed}/${data.overview.giftCards.total} cards redeemed`, icon: <Coins /> },
        { title: t('stats.categories'), value: data.overview.categories.total, meta: `${data.overview.categories.active} ${t('stats.active')}`, icon: <FolderTree /> },
        { title: t('stats.notes'), value: data.overview.notes.total, meta: `${data.overview.notes.active} ${t('stats.active')}`, icon: <BookOpenText /> },
        { title: t('stats.files'), value: data.overview.files.total, meta: `${data.overview.files.totalSizeMB} MB`, icon: <FileStack /> },
        { title: t('stats.evidence'), value: data.overview.blockchain.evidence.total, meta: `${data.overview.blockchain.evidence.finalized} ${t('stats.minted')}`, icon: <ArchiveRestore /> },
      ]
    : []

  return (
    <AdminPage>
      <AdminPageActions>
        <Button icon={<RefreshCw size={15} />} loading={query.isFetching} onClick={() => void query.refetch()}>
          {t('actions.refresh')}
        </Button>
      </AdminPageActions>

      <Row gutter={[10, 10]}>
        {stats.map((item) => (
          <Col xs={24} sm={12} xl={8} xxl={4} key={item.title}>
            <Card className="metric-card" loading={query.isLoading}>
              <Space align="start" className="metric-card-inner">
                <span className="metric-icon">{item.icon}</span>
                <Statistic title={item.title} value={item.value} />
              </Space>
              <Typography.Text type="secondary">{item.meta}</Typography.Text>
            </Card>
          </Col>
        ))}
      </Row>

      {data ? (
        <Row gutter={[10, 10]}>
          <Col xs={24} xl={8}>
            <Card title={t('health.title')} className="dashboard-panel">
              <div className="health-list">
                {Object.entries(data.health).map(([key, value]) => (
                  <div className="health-row" key={key}>
                    <span>{t(`health.${key}`)}</span>
                    <Progress percent={value} size="small" strokeColor="var(--sv-primary)" />
                  </div>
                ))}
              </div>
            </Card>
          </Col>
          <Col xs={24} xl={8}>
            <Card title={t('recent.projects')} className="dashboard-panel">
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={data.recentActivity.projects}
                columns={[
                  { title: t('stats.projects'), dataIndex: 'name' },
                  { title: t('stats.versions'), dataIndex: 'versionCount', width: 90 },
                  { title: 'Published', dataIndex: 'createdAt', width: 130, render: (value: string) => new Date(value).toLocaleDateString() },
                ]}
              />
            </Card>
          </Col>
          <Col xs={24} xl={8}>
            <Card title={t('recent.articles')} className="dashboard-panel">
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={data.recentActivity.articles}
                columns={[
                  { title: t('stats.articles'), dataIndex: 'title', ellipsis: true },
                  { title: t('stats.status'), dataIndex: 'status', width: 82, render: (value: number) => value === 1 ? t('stats.published') : t('stats.draft') },
                  { title: t('stats.updated'), dataIndex: 'updatedAt', width: 110, render: (value: string) => new Date(value).toLocaleDateString() },
                ]}
              />
            </Card>
          </Col>
        </Row>
      ) : null}
    </AdminPage>
  )
}
