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
      message.success('密码已更新，请重新登录')
      router.replace('/login')
      router.refresh()
    },
    onError: (error) => message.error(error.message),
  })

  return (
    <div className="account-route">
      <div className="account-route-heading">
        <div>
          <Typography.Text className="account-eyebrow">Security</Typography.Text>
          <Typography.Title level={2}>安全与登录</Typography.Title>
          <Typography.Text type="secondary">管理密码和可选的钱包登录方式。</Typography.Text>
        </div>
      </div>

      <div className="account-security-grid">
        <Card className="account-card account-route-card" title={<span className="account-card-title"><KeyRound size={16} />密码</span>}>
          <Form form={passwordForm} layout="vertical" onFinish={(values) => passwordMutation.mutate(values)}>
            {user.passwordConfigured ? (
              <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
                <Input.Password prefix={<KeyRound size={14} />} autoComplete="current-password" />
              </Form.Item>
            ) : null}
            <Form.Item name="newPassword" label={user.passwordConfigured ? '新密码' : '设置登录密码'} rules={[{ required: true }, { min: 8, message: '密码至少需要 8 位' }]}>
              <Input.Password prefix={<KeyRound size={14} />} autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              name="confirmPassword"
              label="确认新密码"
              dependencies={['newPassword']}
              rules={[{ required: true }, ({ getFieldValue }) => ({
                validator: async (_, value) => {
                  if (value === getFieldValue('newPassword')) return
                  throw new Error('两次输入的密码不一致')
                },
              })]}
            >
              <Input.Password prefix={<KeyRound size={14} />} autoComplete="new-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={passwordMutation.isPending}>{user.passwordConfigured ? '修改密码' : '设置密码'}</Button>
          </Form>
        </Card>

        <Card className="account-card account-route-card" title={<span className="account-card-title"><WalletCards size={16} />钱包登录</span>}>
          {user.walletAddress ? (
            <div className="account-wallet-bound">
              <Tag color="success">已绑定</Tag>
              <Typography.Paragraph copyable={{ text: user.walletAddress }} className="mono-ellipsis">{user.walletAddress}</Typography.Paragraph>
              <Typography.Text type="secondary">绑定的钱包可用于登录，也可用于管理员的交易存证签名。</Typography.Text>
            </div>
          ) : (
            <div className="account-wallet-empty">
              <ShieldCheck size={20} />
              <Typography.Text>钱包是可选的第二登录方式。</Typography.Text>
              <WalletLoginButton mode="bind" redirectTo="/account/security" />
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
