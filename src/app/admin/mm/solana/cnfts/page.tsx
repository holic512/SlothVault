'use client'

import { App, Button, Space, Table } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { apiFetch } from '@/lib/http'

export default function Page() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['solana-cnfts'],
    queryFn: () => apiFetch<any>('/api/admin/solana/cnft?page=1&pageSize=100')
  })

  return (
    <div>
      <AdminPageHeader title="cNFTs" description="List and manage minted access credentials" />
      <Table
        rowKey="id"
        dataSource={query.data?.list || []}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Project', dataIndex: 'projectName' },
          { title: 'Owner', dataIndex: 'ownerAddress' },
          { title: 'Asset', dataIndex: 'assetId' },
          {
            title: 'Actions',
            render: (_, row: any) => (
              <Space>
                <Button
                  danger
                  onClick={async () => {
                    await apiFetch(`/api/admin/solana/cnft/${row.id}`, { method: 'DELETE' })
                    message.success('cNFT deleted')
                    await queryClient.invalidateQueries({ queryKey: ['solana-cnfts'] })
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
