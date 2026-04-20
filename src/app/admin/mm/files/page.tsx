'use client'

import { App, Button, Space, Table, Upload } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { apiFetch } from '@/lib/http'

export default function Page() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['files'],
    queryFn: () => apiFetch<any>('/api/admin/mm/file?page=1&pageSize=100&includeDeleted=1')
  })

  return (
    <div>
      <AdminPageHeader
        title="Files"
        description="Upload and manage files"
        extra={
          <Upload
            showUploadList={false}
            multiple
            customRequest={async ({ file, onSuccess, onError }) => {
              try {
                const formData = new FormData()
                formData.append('file', file as File)
                await fetch('/api/admin/mm/file?businessType=Other', {
                  method: 'POST',
                  body: formData
                })
                message.success('Upload succeeded')
                onSuccess?.({}, new XMLHttpRequest())
                await queryClient.invalidateQueries({ queryKey: ['files'] })
              } catch (error) {
                onError?.(error as Error)
              }
            }}
          >
            <Button icon={<UploadOutlined />}>Upload</Button>
          </Upload>
        }
      />
      <Table
        rowKey="id"
        dataSource={query.data?.list || []}
        columns={[
          { title: 'Original Name', dataIndex: 'originalName' },
          { title: 'Type', dataIndex: 'businessType' },
          { title: 'Size', dataIndex: 'fileSize' },
          { title: 'URL', render: (_, row: any) => <a href={row.url} target="_blank">{row.url}</a> },
          {
            title: 'Actions',
            render: (_, row: any) => (
              <Space>
                <Button
                  danger
                  onClick={async () => {
                    await apiFetch(`/api/admin/mm/file/${row.id}`, { method: 'DELETE' })
                    message.success('File deleted')
                    await queryClient.invalidateQueries({ queryKey: ['files'] })
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
