'use client'

/**
 * @file account-view.tsx
 * @project SlothVault
 * @module Personal Account Center
 * @description Combines profile editing, public-homepage access, wallet binding, password management, point balance, ledger, and gift-card redemption.
 * @logic Keep the database session/profile as authority, refresh related queries after each mutation, and present optional wallet identity separately from ordinary credentials.
 * @dependencies Ant Design, React Query, auth/account APIs, wallet-login-button
 * @index_tags account,profile,points,gift-card,password,wallet
 * @author holic512
 */
import { useEffect } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App,
  Avatar,
  Button,
  Card,
  Col,
  Form,
  Input,
  Row,
  Space,
  Statistic,
  Table,
  Typography,
} from 'antd'
import { ArrowUpRight, Coins, KeyRound, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { WalletLoginButton } from '@/components/auth/wallet-login-button'
import { apiFetch } from '@/lib/api-client'
import type { SessionUser } from '@/types/user'

type PointEntry = {
  id: string
  amount: number
  balanceAfter: number
  type: string
  description: string | null
  createdAt: string
}

type PointsData = {
  pointsBalance: number
  total: number
  list: PointEntry[]
}

export function AccountView() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [profileForm] = Form.useForm<{
    displayName?: string
    email?: string
    avatar?: string
    bio?: string
  }>()
  const [redeemForm] = Form.useForm<{ code: string }>()
  const [passwordForm] = Form.useForm<{
    currentPassword?: string
    newPassword: string
  }>()

  const userQuery = useQuery({
    queryKey: ['session-user'],
    queryFn: () => apiFetch<SessionUser>('/api/auth/session'),
  })
  const pointsQuery = useQuery({
    queryKey: ['account-points'],
    queryFn: () => apiFetch<PointsData>('/api/account/points?pageSize=50'),
  })
  const user = userQuery.data

  useEffect(() => {
    if (!user) return
    profileForm.setFieldsValue({
      displayName: user.displayName || '',
      email: user.email || '',
      avatar: user.avatar || '',
      bio: user.bio || '',
    })
  }, [profileForm, user])

  const profileMutation = useMutation({
    mutationFn: (values: ReturnType<typeof profileForm.getFieldsValue>) =>
      apiFetch<SessionUser>('/api/account/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: values.displayName || null,
          email: values.email || null,
          avatar: values.avatar || null,
          bio: values.bio || null,
        }),
      }),
    onSuccess: async (nextUser) => {
      queryClient.setQueryData(['session-user'], nextUser)
      message.success('个人资料已保存')
    },
    onError: (error) => message.error(error.message),
  })

  const redeemMutation = useMutation({
    mutationFn: (values: { code: string }) =>
      apiFetch<{ pointsAdded: number; pointsBalance: number }>('/api/account/redeem', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: async (result) => {
      message.success(`已兑换 ${result.pointsAdded} 积分`)
      redeemForm.resetFields()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account-points'] }),
        queryClient.invalidateQueries({ queryKey: ['session-user'] }),
      ])
    },
    onError: (error) => message.error(error.message),
  })

  const passwordMutation = useMutation({
    mutationFn: (values: { currentPassword?: string; newPassword: string }) =>
      apiFetch('/api/account/password', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      message.success('密码已更新，请重新登录')
      router.replace('/login')
      router.refresh()
    },
    onError: (error) => message.error(error.message),
  })

  if (!user) return <div className="account-loading">正在读取账户…</div>

  return (
    <main className="account-main content-container">
      <section className="account-hero">
        <Avatar size={72} src={user.avatar || undefined} icon={<UserRound />} />
        <div>
          <Typography.Text className="account-eyebrow">Personal page</Typography.Text>
          <Typography.Title>{user.displayName || user.username}</Typography.Title>
          <Typography.Paragraph type="secondary">
            @{user.username} · {user.role === 'ADMIN' ? '管理员与文章发布者' : '个人用户'}
          </Typography.Paragraph>
        </div>
        <Space className="account-hero-actions">
          <Link href={`/u/${user.username}`}>
            <Button icon={<ArrowUpRight size={15} />}>查看公开主页</Button>
          </Link>
          {user.role === 'ADMIN' ? <Button type="primary" href="/admin/mm">进入管理后台</Button> : null}
        </Space>
      </section>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <Card title="个人资料" className="account-card">
            <Form
              form={profileForm}
              layout="vertical"
              onFinish={(values) => profileMutation.mutate(values)}
            >
              <div className="account-form-grid">
                <Form.Item name="displayName" label="显示名称"><Input maxLength={80} /></Form.Item>
                <Form.Item name="email" label="邮箱" rules={[{ type: 'email' }]}><Input /></Form.Item>
              </div>
              <Form.Item name="avatar" label="头像地址" rules={[{ type: 'url', warningOnly: true }]}>
                <Input placeholder="https://..." />
              </Form.Item>
              <Form.Item name="bio" label="个人简介"><Input.TextArea rows={5} maxLength={2000} showCount /></Form.Item>
              <Button type="primary" htmlType="submit" loading={profileMutation.isPending}>保存资料</Button>
            </Form>
          </Card>
        </Col>

        <Col xs={24} xl={9}>
          <Space orientation="vertical" size={16} className="full-width">
            <Card className="account-card account-balance-card">
              <Statistic
                title="当前积分"
                value={pointsQuery.data?.pointsBalance ?? user.pointsBalance}
                prefix={<Coins size={18} />}
              />
              <Form form={redeemForm} layout="vertical" onFinish={(values) => redeemMutation.mutate(values)}>
                <Form.Item name="code" label="兑换卡密" rules={[{ required: true, message: '请输入卡密' }]}>
                  <Input placeholder="SV-XXXXX-XXXXX-XXXXX-XXXXX" />
                </Form.Item>
                <Button block htmlType="submit" loading={redeemMutation.isPending}>兑换积分</Button>
              </Form>
            </Card>

            <Card title="登录方式" className="account-card">
              {user.walletAddress ? (
                <Typography.Paragraph copyable={{ text: user.walletAddress }} className="mono-ellipsis">
                  {user.walletAddress}
                </Typography.Paragraph>
              ) : (
                <WalletLoginButton mode="bind" redirectTo="/account" />
              )}
              <Form
                form={passwordForm}
                layout="vertical"
                onFinish={(values) => passwordMutation.mutate(values)}
              >
                {user.passwordConfigured ? (
                  <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true }]}>
                    <Input.Password prefix={<KeyRound size={14} />} />
                  </Form.Item>
                ) : null}
                <Form.Item name="newPassword" label={user.passwordConfigured ? '新密码' : '设置登录密码'} rules={[{ required: true }, { min: 8 }]}>
                  <Input.Password prefix={<KeyRound size={14} />} />
                </Form.Item>
                <Button block htmlType="submit" loading={passwordMutation.isPending}>
                  {user.passwordConfigured ? '修改密码' : '设置密码'}
                </Button>
              </Form>
            </Card>
          </Space>
        </Col>
      </Row>

      <Card title="积分记录" className="account-card account-ledger-card">
        <Table<PointEntry>
          rowKey="id"
          loading={pointsQuery.isLoading}
          dataSource={pointsQuery.data?.list || []}
          pagination={false}
          columns={[
            { title: '时间', dataIndex: 'createdAt', width: 180, render: (value) => new Date(value).toLocaleString() },
            { title: '说明', dataIndex: 'description', render: (value) => value || '积分变动' },
            {
              title: '变动',
              dataIndex: 'amount',
              width: 100,
              align: 'right',
              render: (value) => <strong>{value > 0 ? `+${value}` : value}</strong>,
            },
            { title: '余额', dataIndex: 'balanceAfter', width: 100, align: 'right' },
          ]}
        />
      </Card>
    </main>
  )
}
