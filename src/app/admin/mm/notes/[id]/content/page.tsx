'use client'

import { App, Button, Card, Flex, Form, Input, InputNumber, List, Modal, Space, Switch, Typography } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { use, useState } from 'react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { MarkdownEditor } from '@/components/admin/markdown-editor'
import { apiFetch } from '@/lib/http'

export default function Page({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const { id: noteId } = use(params)
  const [form] = Form.useForm()
  const [editing, setEditing] = useState<any | null>(null)

  const noteQuery = useQuery({
    queryKey: ['note', noteId],
    queryFn: () => apiFetch<any>(`/api/admin/mm/note/${noteId}`)
  })
  const contentsQuery = useQuery({
    queryKey: ['note-contents', noteId],
    queryFn: () => apiFetch<any>(`/api/admin/mm/noteContent?noteInfoId=${noteId}&includeDeleted=1`)
  })

  const mutation = useMutation({
    mutationFn: async (values: any) => {
      if (!noteId) return
      if (editing?.id) {
        return apiFetch(`/api/admin/mm/noteContent/${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values)
        })
      }
      return apiFetch('/api/admin/mm/noteContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, noteInfoId: noteId })
      })
    },
    onSuccess: async () => {
      message.success('Content version saved')
      setEditing(null)
      form.resetFields()
      await queryClient.invalidateQueries({ queryKey: ['note-contents', noteId] })
    }
  })

  return (
    <div>
      <AdminPageHeader
        title={`Note Content: ${noteQuery.data?.noteTitle || noteId}`}
        description="Manage note versions and markdown content"
        extra={<Button type="primary" onClick={() => { setEditing({}); form.resetFields() }}>New version</Button>}
      />
      <Flex gap={16} align="flex-start">
        <Card title="Versions" style={{ width: 320 }}>
          <List
            dataSource={contentsQuery.data?.list || []}
            renderItem={(item: any) => (
              <List.Item
                actions={[
                  <a
                    key="edit"
                    onClick={() => {
                      setEditing(item)
                      form.setFieldsValue(item)
                    }}
                  >
                    Edit
                  </a>,
                  <a
                    key="delete"
                    onClick={async () => {
                      await apiFetch(`/api/admin/mm/noteContent/${item.id}`, { method: 'DELETE' })
                      message.success('Version deleted')
                      await queryClient.invalidateQueries({ queryKey: ['note-contents', noteId] })
                    }}
                  >
                    Delete
                  </a>
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <span>{item.versionNote || 'Untitled version'}</span>
                      {item.isPrimary ? <Typography.Text type="success">Primary</Typography.Text> : null}
                    </Space>
                  }
                  description={new Date(item.updatedAt).toLocaleString()}
                />
              </List.Item>
            )}
          />
        </Card>
        <Card title={editing?.id ? 'Edit version' : 'Create version'} style={{ flex: 1 }}>
          <Form form={form} layout="vertical" onFinish={(values) => mutation.mutate(values)}>
            <Form.Item name="versionNote" label="Version Note">
              <Input />
            </Form.Item>
            <Form.Item name="isPrimary" label="Primary Version" valuePropName="checked" initialValue={false}>
              <Switch />
            </Form.Item>
            <Form.Item name="status" label="Status" initialValue={1}>
              <InputNumber style={{ width: 200 }} />
            </Form.Item>
            <Form.Item name="content" label="Content" rules={[{ required: true }]}>
              <MarkdownEditor />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={mutation.isPending}>
              Save version
            </Button>
          </Form>
        </Card>
      </Flex>
    </div>
  )
}
