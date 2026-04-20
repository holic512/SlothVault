'use client'

import { App, Button, Space, Table } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { apiFetch } from '@/lib/http'

export default function Page() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['solana-trees'],
    queryFn: () => apiFetch<any[]>('/api/admin/solana/tree')
  })

  return (
    <div>
      <AdminPageHeader title="Merkle Trees" description="List and verify tree records" />
      <Table
        rowKey="id"
        dataSource={query.data || []}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Tree Address', dataIndex: 'treeAddress' },
          { title: 'Network', dataIndex: 'network' },
          { title: 'Minted', dataIndex: 'totalMinted' },
          {
            title: 'Actions',
            render: (_, row: any) => (
              <Space>
                <Button
                  onClick={async () => {
                    await apiFetch(`/api/admin/solana/tree/${row.id}/verify`, { method: 'POST' })
                    message.success('Tree verification requested')
                    await queryClient.invalidateQueries({ queryKey: ['solana-trees'] })
                  }}
                >
                  Verify
                </Button>
                <Button
                  danger
                  onClick={async () => {
                    await apiFetch(`/api/admin/solana/tree/${row.id}`, { method: 'DELETE' })
                    message.success('Tree deleted')
                    await queryClient.invalidateQueries({ queryKey: ['solana-trees'] })
                  }}
                >
                  Delete
                </Button>
              </Space>
            )
          }
        ]}
      />
    </div>
  )
}
