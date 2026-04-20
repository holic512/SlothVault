'use client'

import { App, Button, Form, Input, InputNumber, Modal, Space, Switch, Table } from 'antd'
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

  const query = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiFetch<any>('/api/admin/mm/project?page=1&pageSize=100')
  })

  const mutation = useMutation({
    mutationFn: async (values: any) => {
      if (editing) {
        return apiFetch(`/api/admin/mm/project/${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values)
        })
      }
      return apiFetch('/api/admin/mm/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      })
    },
    onSuccess: async () => {
      message.success('Project saved')
      setEditing(null)
      form.resetFields()
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
    }
  })

  return (
    <div>
      <AdminPageHeader
        title="Projects"
        description="Manage projects"
        extra={
          <Button
            type="primary"
            onClick={() => {
              setEditing({})
              form.resetFields()
            }}
          >
            New project
          </Button>
        }
      />
      <Table
        rowKey="id"
        dataSource={query.data?.list || []}
        columns={[
          { title: 'Name', dataIndex: 'projectName' },
          { title: 'Latest Version', dataIndex: 'latestVersion' },
          { title: 'Weight', dataIndex: 'weight' },
          { title: 'Status', dataIndex: 'status' },
          { title: 'Auth', dataIndex: 'requireAuth', render: (value) => String(value) },
          {
            title: 'Actions',
            render: (_, record: any) => (
              <Space>
                <Button
                  onClick={() => {
                    setEditing(record)
                    form.setFieldsValue(record)
                  }}
                >
                  Edit
                </Button>
                <Link href={`/admin/mm/projects/${record.id}/home`}>Home</Link>
                <Button
                  danger
                  onClick={async () => {
                    await apiFetch(`/api/admin/mm/project/${record.id}`, { method: 'DELETE' })
                    message.success('Project deleted')
                    await queryClient.invalidateQueries({ queryKey: ['projects'] })
                  }}
                >
                  Delete
                </Button>
              </Space>
            )
          }
        ]}
      />
      <Modal
        open={Boolean(editing)}
        title={editing?.id ? 'Edit project' : 'New project'}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={mutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(values) => mutation.mutate(values)}>
          <Form.Item name="projectName" label="Project Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="avatar" label="Avatar URL">
            <Input />
          </Form.Item>
          <Form.Item name="weight" label="Weight" initialValue={0}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="status" label="Status" initialValue={1}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="requireAuth" label="Require Auth" valuePropName="checked" initialValue={false}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
