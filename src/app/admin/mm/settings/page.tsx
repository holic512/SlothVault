'use client'

import { App, Button, Card, Form, Input, Space, Spin, Typography } from 'antd'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { apiFetch } from '@/lib/http'

export default function Page() {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const query = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<any>('/api/admin/mm/config')
  })

  useEffect(() => {
    if (query.data?.configs) {
      form.setFieldsValue(Object.fromEntries(query.data.configs.map((config: any) => [config.key, config.value])))
    }
  }, [form, query.data?.configs])

  const mutation = useMutation({
    mutationFn: (values: any) =>
      apiFetch('/api/admin/mm/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configs: Object.entries(values).map(([key, value]) => ({ key, value }))
        })
      }),
    onSuccess: () => message.success('Settings saved')
  })

  if (query.isLoading) return <Spin size="large" />
  const configs = query.data?.configs || []

  return (
    <div>
      <AdminPageHeader title="Settings" description="System and integration settings" />
      <Form
        form={form}
        layout="vertical"
        initialValues={Object.fromEntries(configs.map((config: any) => [config.key, config.value]))}
        onFinish={(values) => mutation.mutate(values)}
      >
        {(query.data?.groups || []).map((group: any) => (
          <Card key={group.key} title={group.label} style={{ marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              {group.configs.map((config: any) => (
                <Form.Item
                  key={config.key}
                  name={config.key}
                  label={
                    <Space direction="vertical" size={0}>
                      <span>{config.key}</span>
                      <Typography.Text type="secondary">{config.description}</Typography.Text>
                    </Space>
                  }
                >
                  <Input />
                </Form.Item>
              ))}
            </Space>
          </Card>
        ))}
        <Button type="primary" htmlType="submit" loading={mutation.isPending}>
          Save
        </Button>
      </Form>
    </div>
  )
}
