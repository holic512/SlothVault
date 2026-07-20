'use client'

/**
 * @file user-register-form.tsx
 * @project SlothVault
 * @module User Registration Form
 * @description Creates a conventional personal account with username, optional email, display name, and password.
 * @logic Validate matching passwords in the browser, submit the server-authoritative registration contract, and enter the shared account session immediately.
 * @dependencies Ant Design, Next navigation, auth API
 * @index_tags register,user,password,profile,form
 * @author holic512
 */
import { useState } from 'react'

import { MailOutlined, LockOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Form, Input, Typography } from 'antd'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { apiFetch } from '@/lib/api-client'
import type { SessionUser } from '@/types/user'

type RegisterValues = {
  username: string
  email?: string
  displayName?: string
  password: string
  confirmPassword: string
}

export function UserRegisterForm() {
  const router = useRouter()
  const { message } = App.useApp()
  const [errorText, setErrorText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (values: RegisterValues) => {
    setSubmitting(true)
    setErrorText('')
    try {
      await apiFetch<SessionUser>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username: values.username,
          email: values.email || undefined,
          displayName: values.displayName || undefined,
          password: values.password,
        }),
      })
      message.success('账户已创建')
      router.replace('/account')
      router.refresh()
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '注册失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="auth-card auth-card--user" variant="borderless">
      <div className="auth-heading auth-heading--editorial">
        <Typography.Text className="auth-kicker">New account</Typography.Text>
        <Typography.Title level={1}>创建个人账户</Typography.Title>
        <Typography.Paragraph type="secondary">
          钱包不是必需条件；用户名和密码就是默认登录方式。
        </Typography.Paragraph>
      </div>

      {errorText ? <Alert className="auth-alert" type="error" showIcon message={errorText} /> : null}

      <Form<RegisterValues>
        layout="vertical"
        size="large"
        requiredMark={false}
        onFinish={(values) => void submit(values)}
      >
        <Form.Item
          name="username"
          rules={[
            { required: true, message: '请输入用户名' },
            { pattern: /^[A-Za-z0-9_]{3,32}$/, message: '使用 3–32 位字母、数字或下划线' },
          ]}
        >
          <Input prefix={<UserOutlined />} placeholder="用户名" autoComplete="username" />
        </Form.Item>
        <Form.Item name="displayName">
          <Input prefix={<UserOutlined />} placeholder="显示名称（可选）" maxLength={80} />
        </Form.Item>
        <Form.Item name="email" rules={[{ type: 'email', message: '邮箱格式不正确' }]}>
          <Input prefix={<MailOutlined />} placeholder="邮箱（可选）" autoComplete="email" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true }, { min: 8, message: '密码至少 8 位' }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          dependencies={['password']}
          rules={[
            { required: true, message: '请再次输入密码' },
            ({ getFieldValue }) => ({
              validator: async (_, value) => {
                if (!value || getFieldValue('password') === value) return
                throw new Error('两次输入的密码不一致')
              },
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="确认密码" autoComplete="new-password" />
        </Form.Item>
        <Button block type="primary" htmlType="submit" loading={submitting}>
          注册并登录
        </Button>
      </Form>

      <Typography.Paragraph className="auth-footnote" type="secondary">
        已有账户？<Link href="/login">返回登录</Link>
      </Typography.Paragraph>
    </Card>
  )
}
