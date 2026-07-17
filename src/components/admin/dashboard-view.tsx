'use client'

import { Alert, Button, Card, Col, Progress, Row, Space, Statistic, Table, Tag, Typography } from 'antd'
import { ArchiveRestore, Blocks, BookOpenText, FileStack, FolderTree, RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '@/lib/api-client'

type DashboardData = {
  overview: {
    users: { total: number; activeSessions: number }
    projects: { total: number; active: number; withAuth: number }
    versions: { total: number; active: number }
    categories: { total: number; active: number }
    notes: { total: number; active: number }
    files: { total: number; totalSizeMB: string }
    blockchain: {
      merkleTrees: { total: number; active: number }
      cnfts: { total: number; minted: number; failed: number; pending: number }
    }
  }
  health: Record<string, number>
  recentActivity: {
    projects: Array<{
      id: string
      name: string
      status: number
      requireAuth: boolean
      versionCount: number
      createdAt: string
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
      <Alert
        type="error"
        showIcon
        message={t('messages.loadFailed')}
        description={query.error.message}
        action={<Button onClick={() => void query.refetch()}>{t('actions.refresh')}</Button>}
      />
    )
  }

  const data = query.data
  const stats = data
    ? [
        { title: t('stats.projects'), value: data.overview.projects.total, meta: `${data.overview.projects.active} ${t('stats.active')}`, icon: <Blocks /> },
        { title: t('stats.categories'), value: data.overview.categories.total, meta: `${data.overview.categories.active} ${t('stats.active')}`, icon: <FolderTree /> },
        { title: t('stats.notes'), value: data.overview.notes.total, meta: `${data.overview.notes.active} ${t('stats.active')}`, icon: <BookOpenText /> },
        { title: t('stats.files'), value: data.overview.files.total, meta: `${data.overview.files.totalSizeMB} MB`, icon: <FileStack /> },
        { title: t('stats.cnfts'), value: data.overview.blockchain.cnfts.total, meta: `${data.overview.blockchain.cnfts.minted} ${t('stats.minted')}`, icon: <ArchiveRestore /> },
      ]
    : []

  return (
    <div className="admin-page-stack">
      <div className="admin-page-heading">
        <div>
          <Typography.Title level={2}>{t('title')}</Typography.Title>
          <Typography.Paragraph type="secondary">{t('desc')}</Typography.Paragraph>
        </div>
        <Button icon={<RefreshCw size={15} />} loading={query.isFetching} onClick={() => void query.refetch()}>
          {t('actions.refresh')}
        </Button>
      </div>

      <Row gutter={[14, 14]}>
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
        <Row gutter={[14, 14]}>
          <Col xs={24} xl={9}>
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
          <Col xs={24} xl={15}>
            <Card title={t('recent.projects')} className="dashboard-panel">
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={data.recentActivity.projects}
                columns={[
                  { title: t('stats.projects'), dataIndex: 'name' },
                  { title: t('stats.versions'), dataIndex: 'versionCount', width: 90 },
                  {
                    title: t('stats.withAuth'),
                    dataIndex: 'requireAuth',
                    width: 110,
                    render: (value: boolean) => (value ? <Tag color="purple">cNFT</Tag> : <Tag>Public</Tag>),
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>
      ) : null}
    </div>
  )
}
