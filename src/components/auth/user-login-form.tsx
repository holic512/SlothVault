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
import { useTranslations } from 'next-intl'
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
  const t = useTranslations('UserAuth.login')
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
          setErrorText(error instanceof Error ? error.message : t('sessionReadFailed'))
        }
      })
  }, [router, t])

  const submit = async (values: LoginValues) => {
    setSubmitting(true)
    setErrorText('')
    try {
      await apiFetch<SessionUser>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(values),
      })
      message.success(t('success'))
      router.replace('/account')
      router.refresh()
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('failed'))
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

      <Form<LoginValues>
        layout="vertical"
        requiredMark={false}
        initialValues={{ remember: false }}
        onFinish={(values) => void submit(values)}
      >
        <Form.Item name="identifier" rules={[{ required: true, message: t('identifierRequired') }]}>
          <Input prefix={<UserOutlined />} placeholder={t('identifier')} autoComplete="username" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true, message: t('passwordRequired') }]}>
          <Input.Password prefix={<LockOutlined />} placeholder={t('password')} autoComplete="current-password" />
        </Form.Item>
        <Form.Item name="remember" valuePropName="checked">
          <Checkbox>{t('remember')}</Checkbox>
        </Form.Item>
        <Button block type="primary" htmlType="submit" loading={submitting}>
          {t('submit')}
        </Button>
      </Form>

      <Divider plain>{t('or')}</Divider>
      <WalletLoginButton />
      <Typography.Paragraph className="auth-footnote" type="secondary">
        {t('noAccount')}<Link href="/register">{t('register')}</Link>
      </Typography.Paragraph>
    </Card>
  )
}
