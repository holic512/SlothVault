'use client'

import { useEffect, useState } from 'react'

import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, App, Button, Card, Form, Input, Typography } from 'antd'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { apiFetch } from '@/lib/api-client'

type InitValues = { username: string; password: string; confirmPassword: string }

export function InitForm() {
  const t = useTranslations('AdminInit')
  const router = useRouter()
  const { message } = App.useApp()
  const [checking, setChecking] = useState(true)
  const [errorText, setErrorText] = useState('')

  useEffect(() => {
    const check = async () => {
      try {
        const state = await apiFetch<{ exists: boolean }>('/api/admin/auth/check')
        if (state.exists) router.replace('/admin/auth/login')
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : t('status.error'))
      } finally {
        setChecking(false)
      }
    }
    void check()
  }, [router, t])

  const submit = async (values: InitValues) => {
    setErrorText('')
    try {
      await apiFetch('/api/admin/auth/init', {
        method: 'POST',
        body: JSON.stringify({ username: values.username, password: values.password }),
      })
      message.success(t('form.submit'))
      router.replace('/admin/auth/login')
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
      <Form<InitValues> layout="vertical" requiredMark={false} onFinish={submit} size="large" disabled={checking}>
        <Form.Item name="username" rules={[{ required: true }, { min: 2 }, { max: 64 }]}> 
          <Input prefix={<UserOutlined />} placeholder={t('form.username')} autoComplete="username" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true }, { min: 8 }, { max: 256 }]}> 
          <Input.Password
            prefix={<LockOutlined />}
            placeholder={t('form.password')}
            autoComplete="new-password"
          />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          dependencies={['password']}
          rules={[
            { required: true, message: t('status.required') },
            ({ getFieldValue }) => ({
              validator(_, value) {
                return !value || getFieldValue('password') === value
                  ? Promise.resolve()
                  : Promise.reject(new Error('Passwords do not match'))
              },
            }),
          ]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder={`${t('form.password')} × 2`}
            autoComplete="new-password"
          />
        </Form.Item>
        <Form.Item className="auth-submit-row">
          <Button block type="primary" htmlType="submit" loading={checking}>
            {t('form.submit')}
          </Button>
        </Form.Item>
      </Form>
    </Card>
  )
}
