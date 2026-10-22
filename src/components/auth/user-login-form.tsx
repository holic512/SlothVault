'use client'

/**
 * @file user-login-form.tsx
 * @project SlothVault
 * @module User Login Form
 * @description Presents focused username/email login with optional wallet login and expandable session guidance.
 * @logic Group independent sign-in preferences, remember only opted-in identifiers, share bounded persistence with wallet login, reset identity caches, and validate role-aware return targets.
 * @dependencies Ant Design, Next navigation, auth API, wallet-login-button
 * @index_tags login,user,password,wallet,form
 * @author holic512
 */
import { useEffect, useState } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import { Alert, App, Button, Card, Checkbox, Divider, Form, Input, Typography } from 'antd'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { authorizedAuthReturn } from '@/lib/auth-return'
import { readRememberedAccount, saveRememberedAccount } from '@/lib/remembered-account'
import { replaceClientSession } from '@/lib/session-client'
import { WalletLoginButton } from '@/components/auth/wallet-login-button'
import { ApiClientError, apiFetch } from '@/lib/api-client'
import type { SessionUser } from '@/types/user'

type LoginValues = {
  identifier: string
  password: string
  remember: boolean
  rememberUsername: boolean
}

export function UserLoginForm({ returnTo = '/account' }: { returnTo?: string }) {
  const t = useTranslations('UserAuth.login')
  const router = useRouter()
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [form] = Form.useForm<LoginValues>()
  const remember = Form.useWatch('remember', form) === true
  const [errorText, setErrorText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [walletSubmitting, setWalletSubmitting] = useState(false)

  useEffect(() => {
    const identifier = readRememberedAccount()
    form.setFieldsValue({ identifier, rememberUsername: Boolean(identifier), remember: false })
  }, [form])

  useEffect(() => {
    const controller = new AbortController()
    apiFetch<SessionUser | null>('/api/auth/session', { signal: controller.signal, cache: 'no-store' })
      .then((user) => {
        if (user && !controller.signal.aborted) router.replace(authorizedAuthReturn(returnTo, user.role))
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        if (!(error instanceof ApiClientError) || error.status !== 401) {
          setErrorText(error instanceof Error ? error.message : t('sessionReadFailed'))
        }
      })
    return () => controller.abort()
  }, [router, t, returnTo])

  const submit = async (values: LoginValues) => {
    setSubmitting(true)
    setErrorText('')
    try {
      const user = await apiFetch<SessionUser>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: values.identifier, password: values.password, remember: values.remember }),
      })
      saveRememberedAccount(values.rememberUsername ? values.identifier : null)
      await replaceClientSession(queryClient, user)
      message.success(t('success'))
      router.replace(authorizedAuthReturn(returnTo, user.role))
      router.refresh()
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="auth-card auth-card--user auth-card--login" variant="borderless">
      <div className="auth-heading auth-heading--editorial">
        <Typography.Title level={1}>{t('title')}</Typography.Title>
      </div>

      {errorText ? <Alert className="auth-alert" type="error" showIcon title={errorText} /> : null}

      <Form<LoginValues>
        className="auth-login-form"
        form={form}
        disabled={walletSubmitting || submitting}
        layout="vertical"
        requiredMark={false}
        initialValues={{ remember: false, rememberUsername: false }}
        onFinish={(values) => void submit(values)}
      >
        <Form.Item name="identifier" label={t('identifier')} rules={[{ required: true, message: t('identifierRequired') }]}>
          <Input autoComplete="username" />
        </Form.Item>
        <Form.Item name="password" label={t('password')} rules={[{ required: true, message: t('passwordRequired') }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <div className="auth-login-preferences">
          <Form.Item name="rememberUsername" valuePropName="checked">
            <Checkbox onChange={event => { if (!event.target.checked) saveRememberedAccount(null) }}>{t('rememberUsername')}</Checkbox>
          </Form.Item>
          <Form.Item name="remember" valuePropName="checked">
            <Checkbox>{t('remember')}</Checkbox>
          </Form.Item>
        </div>
        <details className="auth-login-session">
          <summary>{t('sessionDetails')}</summary>
          <Typography.Paragraph type="secondary">{t(remember ? 'persistentHint' : 'sessionHint')}</Typography.Paragraph>
        </details>
        <Button className="auth-login-submit" block type="primary" htmlType="submit" loading={submitting} disabled={walletSubmitting}>
          {t('submit')}
        </Button>
      </Form>

      <Divider plain>{t('or')}</Divider>
      <div className="auth-login-alternative">
        <WalletLoginButton remember={remember} redirectTo={returnTo} disabled={submitting} onBusyChange={setWalletSubmitting} />
      </div>
      <Typography.Paragraph className="auth-footnote auth-login-register" type="secondary">
        {t('noAccount')}<Link href={returnTo === '/account' ? '/register' : `/register?next=${encodeURIComponent(returnTo)}`}>{t('register')}</Link>
      </Typography.Paragraph>
    </Card>
  )
}
