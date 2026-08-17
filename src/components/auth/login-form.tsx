'use client'

/**
 * @file login-form.tsx
 * @project SlothVault
 * @module Administrator Login
 * @description Implements the administrator sign-in and first-run redirect flow with Ant Design forms.
 * @logic Detect initialization/session state, preserve the optional remembered username locally, and establish an HTTP-only session.
 * @dependencies antd, next-intl, api-client, Next navigation
 * @index_tags login,admin,form,session
 * @author holic512
 */
import { useEffect, useState } from 'react'

import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Checkbox, Form, Input, Space, Typography } from 'antd'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { ApiClientError, apiFetch } from '@/lib/api-client'

const STORAGE_KEY = 'admin_remembered_username'

type LoginValues = {
  username: string
  password: string
  rememberUsername: boolean
  remember: boolean
}

export function LoginForm() {
  const t = useTranslations('AdminLogin')
  const router = useRouter()
  const { message } = App.useApp()
  const [form] = Form.useForm<LoginValues>()
  const [checking, setChecking] = useState(true)
  const [errorText, setErrorText] = useState('')

  useEffect(() => {
    const rememberedUsername = window.localStorage.getItem(STORAGE_KEY) || ''
    form.setFieldsValue({
      username: rememberedUsername,
      rememberUsername: Boolean(rememberedUsername),
      remember: false,
    })

    const check = async () => {
      try {
        const state = await apiFetch<{ exists: boolean }>('/api/admin/auth/check')
        if (!state.exists) {
          router.replace('/admin/auth/init')
          return
        }

        try {
          await apiFetch('/api/admin/auth/session')
          router.replace('/admin/mm')
          return
        } catch (error) {
          if (!(error instanceof ApiClientError) || error.status !== 401) throw error
        }
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : t('status.error'))
      } finally {
        setChecking(false)
      }
    }

    void check()
  }, [form, router, t])

  const submit = async (values: LoginValues) => {
    setErrorText('')
    try {
      await apiFetch('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: values.username,
          password: values.password,
          remember: values.remember,
        }),
      })

      if (values.rememberUsername) {
        window.localStorage.setItem(STORAGE_KEY, values.username)
      } else {
        window.localStorage.removeItem(STORAGE_KEY)
      }

      message.success(t('form.submit'))
      router.replace('/admin/mm')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t('status.error'))
    }
  }

  return (
    <Card className="auth-card" variant="borderless">
      <div className="auth-heading">
        <Typography.Text className="auth-kicker">{t('hero.badge')}</Typography.Text>
        <Typography.Title level={1}>{t('hero.title')}</Typography.Title>
        <Typography.Paragraph type="secondary">{t('hero.desc')}</Typography.Paragraph>
      </div>

      {errorText ? <Alert className="auth-alert" type="error" showIcon message={errorText} /> : null}

      <Form form={form} layout="vertical" requiredMark={false} onFinish={submit} disabled={checking}>
        <Form.Item name="username" rules={[{ required: true, message: t('status.required') }]}> 
          <Input prefix={<UserOutlined />} placeholder={t('form.username')} autoComplete="username" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true, message: t('status.required') }]}> 
          <Input.Password
            prefix={<LockOutlined />}
            placeholder={t('form.password')}
            autoComplete="current-password"
          />
        </Form.Item>
        <Space orientation="vertical" size={7} className="auth-options">
          <Form.Item name="rememberUsername" valuePropName="checked" noStyle>
            <Checkbox>{t('form.rememberUsername')}</Checkbox>
          </Form.Item>
          <Form.Item name="remember" valuePropName="checked" noStyle>
            <Checkbox>{t('form.stayLoggedIn')}</Checkbox>
          </Form.Item>
        </Space>
        <Form.Item className="auth-submit-row">
          <Button block type="primary" htmlType="submit" loading={checking}>
            {t('form.submit')}
          </Button>
        </Form.Item>
      </Form>
    </Card>
  )
}
