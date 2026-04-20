'use client'

import { Card, Col, Row, Spin, Tag } from 'antd'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'

import { LiquidNavbar } from '@/components/public/liquid-navbar'
import { apiFetch } from '@/lib/http'

type Project = {
  id: string
  projectName: string
  avatar: string | null
  latestVersion: string | null
  latestVersionDesc: string | null
  categoryCount: number
  requireAuth: boolean
  accessPriceSol: string | null
  purchaseEnabled: boolean
}

export function ProjectListPage() {
  const query = useQuery({
    queryKey: ['project-list'],
    queryFn: () => apiFetch<Project[]>('/api/project/list')
  })

  return (
    <>
      <LiquidNavbar />
      <div style={{ padding: '96px 32px 48px' }}>
        {query.isLoading ? (
          <Spin size="large" />
        ) : (
          <Row gutter={[24, 24]}>
            {(query.data || []).map((project) => (
              <Col key={project.id} xs={24} md={12} xl={8}>
                <Link href={`/project/${project.id}/home`}>
                  <Card hoverable>
                    <Card.Meta
                      title={project.projectName}
                      description={project.latestVersionDesc || project.latestVersion || 'No version'}
                    />
                    <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                      {project.requireAuth ? <Tag color="gold">cNFT</Tag> : <Tag color="blue">Public</Tag>}
                      {project.purchaseEnabled && project.accessPriceSol ? <Tag color="green">{project.accessPriceSol} SOL</Tag> : null}
                      <Tag>{project.categoryCount} categories</Tag>
                    </div>
                  </Card>
                </Link>
              </Col>
            ))}
          </Row>
        )}
      </div>
    </>
  )
}
