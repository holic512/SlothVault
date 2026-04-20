'use client'

import { Alert, Button, Card, Checkbox, Form, Input, Space, Typography } from 'antd'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { apiFetch, ApiError } from '@/lib/http'
import { useUserStore } from '@/store/user'
import { ThemeToggle } from '@/components/theme/theme-toggle'

const STORAGE_KEY = 'admin_remembered_username'

export function LoginForm() {
  const router = useRouter()
  const setUsername = useUserStore((state) => state.setUsername)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()

  const initialUsername = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) || '' : ''

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 32 }}>
      <Card style={{ width: 420 }}>
        <Space direction="vertical" size={24} style={{ width: '100%' }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Title level={3} style={{ margin: 0 }}>
              Admin Login
            </Typography.Title>
            <ThemeToggle />
          </Space>
          {error ? <Alert type="error" message={error} /> : null}
          <Form
            form={form}
            layout="vertical"
            initialValues={{
              username: initialUsername,
              rememberUsername: Boolean(initialUsername)
            }}
            onFinish={async (values) => {
              setLoading(true)
              setError('')
              try {
                const result = await apiFetch<{ username: string }>('/api/admin/auth/login', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    username: values.username,
                    password: values.password,
                    remember: values.stayLoggedIn
                  })
                })
                if (values.rememberUsername) {
                  localStorage.setItem(STORAGE_KEY, values.username)
                } else {
                  localStorage.removeItem(STORAGE_KEY)
                }
                setUsername(result.username)
                router.push('/admin/mm')
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Login failed')
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
            <Form.Item name="rememberUsername" valuePropName="checked">
              <Checkbox>Remember username</Checkbox>
            </Form.Item>
            <Form.Item name="stayLoggedIn" valuePropName="checked">
              <Checkbox>Stay logged in</Checkbox>
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              Login
            </Button>
          </Form>
          <Link href="/admin/auth/init">Initialize admin</Link>
        </Space>
      </Card>
    </div>
  )
}
