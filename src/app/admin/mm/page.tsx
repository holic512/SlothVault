'use client'

import { Card, Col, List, Row, Spin, Statistic } from 'antd'
import { useQuery } from '@tanstack/react-query'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { apiFetch } from '@/lib/http'

export default function Page() {
  const query = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => apiFetch<any>('/api/admin/mm/dashboard')
  })

  return (
    <div>
      <AdminPageHeader title="Dashboard" description="System overview" />
      {query.isLoading ? <Spin size="large" /> : null}
      {query.data ? (
        <>
          <Row gutter={[16, 16]}>
            <Col span={6}>
              <Card><Statistic title="Projects" value={query.data.overview.projects.total} /></Card>
            </Col>
            <Col span={6}>
              <Card><Statistic title="Versions" value={query.data.overview.versions.total} /></Card>
            </Col>
            <Col span={6}>
              <Card><Statistic title="Notes" value={query.data.overview.notes.total} /></Card>
            </Col>
            <Col span={6}>
              <Card><Statistic title="Files" value={query.data.overview.files.total} /></Card>
            </Col>
          </Row>
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col span={12}>
              <Card title="Recent Projects">
                <List
                  dataSource={query.data.recentActivity.projects}
                  renderItem={(item: any) => <List.Item>{item.name}</List.Item>}
                />
              </Card>
            </Col>
            <Col span={12}>
              <Card title="Recent Notes">
                <List
                  dataSource={query.data.recentActivity.notes}
                  renderItem={(item: any) => <List.Item>{item.title}</List.Item>}
                />
              </Card>
            </Col>
          </Row>
        </>
      ) : null}
    </div>
  )
}
