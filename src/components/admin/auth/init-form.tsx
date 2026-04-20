'use client'

import { Alert, Button, Card, Form, Input, Space, Typography } from 'antd'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { apiFetch, ApiError } from '@/lib/http'

export function InitForm() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 32 }}>
      <Card style={{ width: 420 }}>
        <Space direction="vertical" size={24} style={{ width: '100%' }}>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Initialize Admin
          </Typography.Title>
          {error ? <Alert type="error" message={error} /> : null}
          <Form
            layout="vertical"
            onFinish={async (values) => {
              setLoading(true)
              setError('')
              try {
                await apiFetch('/api/admin/auth/init', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(values)
                })
                router.push('/admin/auth/login')
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Initialization failed')
              } finally {
                setLoading(false)
              }
            }}
          >
            <Form.Item name="username" label="Username" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="password" label="Password" rules={[{ required: true }]}>
              <Input.Password />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              Create admin
            </Button>
          </Form>
        </Space>
      </Card>
    </div>
  )
}
