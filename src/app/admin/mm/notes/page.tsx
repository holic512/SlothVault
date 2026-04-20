'use client'

import { App, Button, Form, Input, InputNumber, Modal, Select, Space, Table } from 'antd'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { apiFetch } from '@/lib/http'

export default function Page() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [editing, setEditing] = useState<any | null>(null)

  const notesQuery = useQuery({
    queryKey: ['notes'],
    queryFn: () => apiFetch<any>('/api/admin/mm/note?page=1&pageSize=100')
  })
  const categoriesQuery = useQuery({
    queryKey: ['categories-options'],
    queryFn: () => apiFetch<any>('/api/admin/mm/category?page=1&pageSize=200&includeProjectVersion=1')
  })

  const mutation = useMutation({
    mutationFn: async (values: any) => {
      if (editing?.id) {
        return apiFetch(`/api/admin/mm/note/${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values)
        })
      }
      return apiFetch('/api/admin/mm/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      })
    },
    onSuccess: async () => {
      message.success('Note saved')
      setEditing(null)
      form.resetFields()
      await queryClient.invalidateQueries({ queryKey: ['notes'] })
    }
  })

  return (
    <div>
      <AdminPageHeader
        title="Notes"
        description="Manage note metadata and versions"
        extra={<Button type="primary" onClick={() => { setEditing({}); form.resetFields() }}>New note</Button>}
      />
      <Table
        rowKey="id"
        dataSource={notesQuery.data?.list || []}
        columns={[
          { title: 'Title', dataIndex: 'noteTitle' },
          { title: 'Project', render: (_, row: any) => row.category?.projectVersion?.project?.projectName },
          { title: 'Category', render: (_, row: any) => row.category?.categoryName },
          { title: 'Versions', dataIndex: 'contentCount' },
          {
            title: 'Actions',
            render: (_, row: any) => (
              <Space>
                <Button onClick={() => { setEditing(row); form.setFieldsValue(row) }}>Edit</Button>
                <Link href={`/admin/mm/notes/${row.id}/content`}>Content</Link>
                <Button
                  danger
                  onClick={async () => {
                    await apiFetch(`/api/admin/mm/note/${row.id}`, { method: 'DELETE' })
                    message.success('Note deleted')
                    await queryClient.invalidateQueries({ queryKey: ['notes'] })
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
          <Form.Item name="categoryId" label="Category" rules={[{ required: true }]}>
            <Select
              options={(categoriesQuery.data?.list || []).map((item: any) => ({
                value: item.id,
                label: `${item.projectVersion?.project?.projectName || ''} / ${item.projectVersion?.version || ''} / ${item.categoryName}`
              }))}
            />
          </Form.Item>
          <Form.Item name="noteTitle" label="Note Title" rules={[{ required: true }]}>
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
