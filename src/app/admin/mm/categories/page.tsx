'use client'

import { App, Button, Form, Input, InputNumber, Modal, Select, Space, Table } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { apiFetch } from '@/lib/http'

export default function Page() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [editing, setEditing] = useState<any | null>(null)

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<any>('/api/admin/mm/category?page=1&pageSize=100&includeProjectVersion=1')
  })
  const versionsQuery = useQuery({
    queryKey: ['project-versions-admin'],
    queryFn: () => apiFetch<any>('/api/admin/mm/projectVersion?page=1&pageSize=100')
  })

  const mutation = useMutation({
    mutationFn: async (values: any) => {
      if (editing?.id) {
        return apiFetch(`/api/admin/mm/category/${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values)
        })
      }
      return apiFetch('/api/admin/mm/category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      })
    },
    onSuccess: async () => {
      message.success('Category saved')
      setEditing(null)
      form.resetFields()
      await queryClient.invalidateQueries({ queryKey: ['categories'] })
    }
  })

  return (
    <div>
      <AdminPageHeader
        title="Categories"
        description="Manage project version categories"
        extra={<Button type="primary" onClick={() => { setEditing({}); form.resetFields() }}>New category</Button>}
      />
      <Table
        rowKey="id"
        dataSource={categoriesQuery.data?.list || []}
        columns={[
          { title: 'Name', dataIndex: 'categoryName' },
          { title: 'Project', render: (_, row: any) => row.projectVersion?.project?.projectName },
          { title: 'Version', render: (_, row: any) => row.projectVersion?.version },
          { title: 'Weight', dataIndex: 'weight' },
          {
            title: 'Actions',
            render: (_, row: any) => (
              <Space>
                <Button onClick={() => { setEditing(row); form.setFieldsValue(row) }}>Edit</Button>
                <Button
                  danger
                  onClick={async () => {
                    await apiFetch(`/api/admin/mm/category/${row.id}`, { method: 'DELETE' })
                    message.success('Category deleted')
                    await queryClient.invalidateQueries({ queryKey: ['categories'] })
                  }}
                >
                  Delete
                </Button>
              </Space>
            )
          }
        ]}
      />
      <Modal open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={mutation.isPending}>
        <Form form={form} layout="vertical" onFinish={(values) => mutation.mutate(values)}>
          <Form.Item name="projectVersionId" label="Project Version" rules={[{ required: true }]}>
            <Select
              options={(versionsQuery.data?.list || []).map((item: any) => ({
                value: item.id,
                label: item.version
              }))}
            />
          </Form.Item>
          <Form.Item name="categoryName" label="Category Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="weight" label="Weight" initialValue={0}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="status" label="Status" initialValue={1}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
