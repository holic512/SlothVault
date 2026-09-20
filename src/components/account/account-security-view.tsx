'use client'

/**
 * @file account-security-view.tsx
 * @project SlothVault
 * @module Account Security Settings
 * @description Provides dedicated password and optional wallet-login controls for the authenticated account.
 * @logic Keep wallet ownership separate from passwords, revoke sessions through the existing password API, and route users to login after credentials change.
 * @dependencies React Query, Ant Design, Next navigation, wallet-login-button, account APIs
 * @index_tags account,security,password,wallet,session
 * @author holic512
 */
import { useMutation } from '@tanstack/react-query'
import { App, Button, Card, Form, Input, Tag, Typography } from 'antd'
import { KeyRound, ShieldCheck, WalletCards } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { useAccountUser } from '@/components/account/account-shell'
import { WalletLoginButton } from '@/components/auth/wallet-login-button'
import { apiFetch } from '@/lib/api-client'

type PasswordValues = {
  currentPassword?: string
  newPassword: string
  confirmPassword: string
}

export function AccountSecurityView() {
  const t = useTranslations('Account.security')
  const user = useAccountUser()
  const router = useRouter()
  const { message } = App.useApp()
  const [passwordForm] = Form.useForm<PasswordValues>()
  const passwordMutation = useMutation({
    mutationFn: (values: PasswordValues) =>
      apiFetch('/api/account/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: values.currentPassword, newPassword: values.newPassword }),
      }),
    onSuccess: () => {
      message.success(t('updated'))
      router.replace('/login')
      router.refresh()
    },
    onError: (error) => message.error(error.message),
  })

  return (
    <div className="account-route">
      <div className="account-route-heading">
        <div>
          <Typography.Text className="account-eyebrow">{t('kicker')}</Typography.Text>
          <Typography.Title level={2}>{t('title')}</Typography.Title>
          <Typography.Text type="secondary">{t('description')}</Typography.Text>
        </div>
      </div>

      <div className="account-security-grid">
        <Card className="account-card account-route-card" title={<span className="account-card-title"><KeyRound size={16} />{t('passwordTitle')}</span>}>
          <Form form={passwordForm} layout="vertical" onFinish={(values) => passwordMutation.mutate(values)}>
            {user.passwordConfigured ? (
              <Form.Item name="currentPassword" label={t('currentPassword')} rules={[{ required: true, message: t('currentPasswordRequired') }]}>
                <Input.Password prefix={<KeyRound size={14} />} autoComplete="current-password" />
              </Form.Item>
            ) : null}
            <Form.Item name="newPassword" label={user.passwordConfigured ? t('newPassword') : t('setPassword')} rules={[{ required: true }, { min: 8, message: t('passwordMin') }]}>
              <Input.Password prefix={<KeyRound size={14} />} autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              name="confirmPassword"
              label={t('confirmPassword')}
              dependencies={['newPassword']}
              rules={[{ required: true }, ({ getFieldValue }) => ({
                validator: async (_, value) => {
                  if (value === getFieldValue('newPassword')) return
                  throw new Error(t('passwordMismatch'))
                },
              })]}
            >
              <Input.Password prefix={<KeyRound size={14} />} autoComplete="new-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={passwordMutation.isPending}>{user.passwordConfigured ? t('changePassword') : t('setPassword')}</Button>
          </Form>
        </Card>

        <Card className="account-card account-route-card" title={<span className="account-card-title"><WalletCards size={16} />{t('walletTitle')}</span>}>
          {user.walletAddress ? (
            <div className="account-wallet-bound">
              <Tag color="success">{t('bound')}</Tag>
              <Typography.Paragraph copyable={{ text: user.walletAddress }} className="mono-ellipsis">{user.walletAddress}</Typography.Paragraph>
              <Typography.Text type="secondary">{t('walletBoundHint')}</Typography.Text>
            </div>
          ) : (
            <div className="account-wallet-empty">
              <ShieldCheck size={20} />
              <Typography.Text>{t('walletEmptyHint')}</Typography.Text>
              <WalletLoginButton mode="bind" redirectTo="/account/security" />
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
