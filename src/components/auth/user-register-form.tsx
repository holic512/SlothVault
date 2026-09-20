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
import { useTranslations } from 'next-intl'
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
  const t = useTranslations('UserAuth.register')
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
      message.success(t('success'))
      router.replace('/account')
      router.refresh()
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="auth-card auth-card--user" variant="borderless">
      <div className="auth-heading auth-heading--editorial">
        <Typography.Text className="auth-kicker">{t('kicker')}</Typography.Text>
        <Typography.Title level={1}>{t('title')}</Typography.Title>
        <Typography.Paragraph type="secondary">
          {t('description')}
        </Typography.Paragraph>
      </div>

      {errorText ? <Alert className="auth-alert" type="error" showIcon title={errorText} /> : null}

      <Form<RegisterValues>
        layout="vertical"
        size="large"
        requiredMark={false}
        onFinish={(values) => void submit(values)}
      >
        <Form.Item
          name="username"
          rules={[
            { required: true, message: t('usernameRequired') },
            { pattern: /^[A-Za-z0-9_]{3,32}$/, message: t('usernameFormat') },
          ]}
        >
          <Input prefix={<UserOutlined />} placeholder={t('username')} autoComplete="username" />
        </Form.Item>
        <Form.Item name="displayName">
          <Input prefix={<UserOutlined />} placeholder={t('displayName')} maxLength={80} />
        </Form.Item>
        <Form.Item name="email" rules={[{ type: 'email', message: t('emailInvalid') }]}>
          <Input prefix={<MailOutlined />} placeholder={t('email')} autoComplete="email" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true }, { min: 8, message: t('passwordMin') }]}>
          <Input.Password prefix={<LockOutlined />} placeholder={t('password')} autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          dependencies={['password']}
          rules={[
            { required: true, message: t('confirmPasswordRequired') },
            ({ getFieldValue }) => ({
              validator: async (_, value) => {
                if (!value || getFieldValue('password') === value) return
                throw new Error(t('passwordMismatch'))
              },
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder={t('confirmPassword')} autoComplete="new-password" />
        </Form.Item>
        <Button block type="primary" htmlType="submit" loading={submitting}>
          {t('submit')}
        </Button>
      </Form>

      <Typography.Paragraph className="auth-footnote" type="secondary">
        {t('hasAccount')}<Link href="/login">{t('login')}</Link>
      </Typography.Paragraph>
    </Card>
  )
}
