'use client'

import { Table, Tag } from 'antd'
import { useQuery } from '@tanstack/react-query'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { apiFetch } from '@/lib/http'

function statusToTag(status: number) {
  if (status === 2) return <Tag color="green">completed</Tag>
  if (status === 1) return <Tag color="blue">submitted</Tag>
  if (status === 0) return <Tag color="gold">prepared</Tag>
  if (status === -2) return <Tag color="default">expired</Tag>
  return <Tag color="red">failed</Tag>
}

export default function Page() {
  const query = useQuery({
    queryKey: ['solana-purchases'],
    queryFn: () => apiFetch<any>('/api/admin/solana/purchase?page=1&pageSize=100'),
  })

  return (
    <div>
      <AdminPageHeader title="Purchases" description="Project purchase records and cNFT grant results" />
      <Table
        rowKey="id"
        dataSource={query.data?.list || []}
        columns={[
          { title: 'Project', dataIndex: 'projectName' },
          { title: 'Buyer', dataIndex: 'buyerWalletAddress' },
          { title: 'Receiver', dataIndex: 'receiverWalletAddress' },
          { title: 'Network', dataIndex: 'network' },
          { title: 'Price', render: (_, row: any) => `${row.priceSol} SOL` },
          { title: 'Status', render: (_, row: any) => statusToTag(row.status) },
          { title: 'Asset', dataIndex: 'assetId' },
          { title: 'Tx', dataIndex: 'txSignature' },
          { title: 'Created', dataIndex: 'createdAt' },
          { title: 'Confirmed', dataIndex: 'confirmedAt' },
        ]}
      />
    </div>
  )
}
