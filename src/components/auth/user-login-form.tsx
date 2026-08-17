'use client'

/**
 * @file user-login-form.tsx
 * @project SlothVault
 * @module User Login Form
 * @description Implements conventional username/email login with wallet address login as a secondary option.
 * @logic Submit password credentials to the shared session API, keep the wallet flow visually subordinate, and send authenticated users to their account center.
 * @dependencies Ant Design, Next navigation, auth API, wallet-login-button
 * @index_tags login,user,password,wallet,form
 * @author holic512
 */
import { useEffect, useState } from 'react'

import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Checkbox, Divider, Form, Input, Typography } from 'antd'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { WalletLoginButton } from '@/components/auth/wallet-login-button'
import { ApiClientError, apiFetch } from '@/lib/api-client'
import type { SessionUser } from '@/types/user'

type LoginValues = {
  identifier: string
  password: string
  remember: boolean
}

export function UserLoginForm() {
  const router = useRouter()
  const { message } = App.useApp()
  const [errorText, setErrorText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    apiFetch<SessionUser | null>('/api/auth/session')
      .then((user) => {
        if (user) router.replace('/account')
      })
      .catch((error) => {
        if (!(error instanceof ApiClientError) || error.status !== 401) {
          setErrorText(error instanceof Error ? error.message : '无法读取登录状态')
        }
      })
  }, [router])

  const submit = async (values: LoginValues) => {
    setSubmitting(true)
    setErrorText('')
    try {
      await apiFetch<SessionUser>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(values),
      })
      message.success('登录成功')
      router.replace('/account')
      router.refresh()
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="auth-card auth-card--user" variant="borderless">
      <div className="auth-heading auth-heading--editorial">
        <Typography.Text className="auth-kicker">Account</Typography.Text>
        <Typography.Title level={1}>登录 SlothVault</Typography.Title>
        <Typography.Paragraph type="secondary">
          用普通账户阅读、管理个人主页和兑换积分。
        </Typography.Paragraph>
      </div>

      {errorText ? <Alert className="auth-alert" type="error" showIcon message={errorText} /> : null}

      <Form<LoginValues>
        layout="vertical"
        requiredMark={false}
        initialValues={{ remember: false }}
        onFinish={(values) => void submit(values)}
      >
        <Form.Item name="identifier" rules={[{ required: true, message: '请输入用户名或邮箱' }]}>
          <Input prefix={<UserOutlined />} placeholder="用户名或邮箱" autoComplete="username" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" />
        </Form.Item>
        <Form.Item name="remember" valuePropName="checked">
          <Checkbox>保持登录 30 天</Checkbox>
        </Form.Item>
        <Button block type="primary" htmlType="submit" loading={submitting}>
          登录
        </Button>
      </Form>

      <Divider plain>或</Divider>
      <WalletLoginButton />
      <Typography.Paragraph className="auth-footnote" type="secondary">
        还没有账户？<Link href="/register">注册个人账户</Link>
      </Typography.Paragraph>
    </Card>
  )
}
