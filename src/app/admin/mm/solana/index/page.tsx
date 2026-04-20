'use client'

import { Card, Col, Row } from 'antd'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { apiFetch } from '@/lib/http'

export default function Page() {
  const trees = useQuery({
    queryKey: ['solana-trees-overview'],
    queryFn: () => apiFetch<any[]>('/api/admin/solana/tree')
  })
  const cnfts = useQuery({
    queryKey: ['solana-cnfts-overview'],
    queryFn: () => apiFetch<any>('/api/admin/solana/cnft?page=1&pageSize=1')
  })
  const purchases = useQuery({
    queryKey: ['solana-purchases-overview'],
    queryFn: () => apiFetch<any>('/api/admin/solana/purchase?page=1&pageSize=1')
  })

  return (
    <div>
      <AdminPageHeader title="Solana" description="Tree and cNFT overview" />
      <Row gutter={[16, 16]}>
        <Col span={8}>
          <Card title="Merkle Trees" extra={<Link href="/admin/mm/solana/trees">Open</Link>}>
            {trees.data?.length || 0}
          </Card>
        </Col>
        <Col span={8}>
          <Card title="cNFTs" extra={<Link href="/admin/mm/solana/cnfts">Open</Link>}>
            {cnfts.data?.total || 0}
          </Card>
        </Col>
        <Col span={8}>
          <Card title="Purchases" extra={<Link href="/admin/mm/solana/purchases">Open</Link>}>
            {purchases.data?.total || 0}
          </Card>
        </Col>
      </Row>
    </div>
  )
}
