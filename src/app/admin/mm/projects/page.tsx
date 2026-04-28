'use client'

import { App, Button, Form, Input, InputNumber, Modal, Select, Space, Table, Typography } from 'antd'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { AdminStatusSelect, renderAuthTag, renderStatusBadge } from '@/components/admin/admin-status'
import { apiFetch } from '@/lib/http'

export default function Page() {
  const { message, modal } = App.useApp()
  const router = useRouter()
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
    onSuccess: async (result: any) => {
      message.success(editing?.id ? 'Project updated' : 'Project created')
      setEditing(null)
      form.resetFields()
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      if (!editing?.id && result?.id) {
        router.push(`/admin/mm/projects/${result.id}?tab=content&focus=version`)
      }
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
          {
            title: 'Price',
            dataIndex: 'accessPriceSol',
            render: (value: string | null, row: any) =>
              row.requireAuth ? (value ? `${value} SOL` : 'Manual only') : 'Public'
          },
          { title: 'Weight', dataIndex: 'weight' },
          { title: 'Status', dataIndex: 'status', render: (value: number) => renderStatusBadge(value) },
          { title: 'Access', dataIndex: 'requireAuth', render: (value: boolean) => renderAuthTag(value) },
          {
            title: 'Actions',
            render: (_, record: any) => (
              <Space>
                <Link href={`/admin/mm/projects/${record.id}?tab=content`}>Open Workspace</Link>
                <Button onClick={() => {
                  setEditing(record)
                  form.setFieldsValue(record)
                }}>
                  Edit
                </Button>
                <Button
                  danger
                  onClick={async () => {
                    modal.confirm({
                      title: 'Archive project',
                      content: `Move ${record.projectName} to archive?`,
                      okText: 'Archive',
                      okButtonProps: { danger: true },
                      cancelText: 'Cancel',
                      onOk: async () => {
                        await apiFetch(`/api/admin/mm/project/${record.id}`, { method: 'DELETE' })
                        message.success('Project moved to archive')
                        await queryClient.invalidateQueries({ queryKey: ['projects'] })
                      }
                    })
                  }}
                >
                  Archive
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
            <AdminStatusSelect style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="requireAuth" label="Require Auth" initialValue={false}>
            <Select
              style={{ width: '100%' }}
              options={[
                { label: 'Public', value: false },
                { label: 'Protected', value: true }
              ]}
            />
          </Form.Item>
          <Form.Item
            name="accessPriceSol"
            label="Access Price (SOL)"
            tooltip="Leave empty or 0 to disable self-service purchase."
          >
            <InputNumber stringMode min="0" step="0.0001" style={{ width: '100%' }} />
          </Form.Item>
          <Typography.Text type="secondary">
            Price only applies to auth-protected projects.
          </Typography.Text>
        </Form>
      </Modal>
    </div>
  )
}
