'use client'

/**
 * @file users-manager.tsx
 * @project SlothVault
 * @module User Administration
 * @description Provides administrator-managed user creation, profile and access updates, reversible account deletion, password resets, and point adjustments.
 * @logic Query bounded user pages, keep credentials private, submit identity mutations through protected APIs, revoke sessions after access changes, and retain the point ledger workflow.
 * @dependencies Ant Design, React Query, next-intl, admin user APIs
 * @index_tags admin,users,crud,password,points,ledger
 * @author holic512
 */
import { useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag } from 'antd'
import { Coins, Crown, KeyRound, Pencil, Plus, RefreshCw, Search, Trash2, UserRound } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { AdminPage, AdminPageActions, AdminTablePanel, AdminToolbar } from '@/components/admin/admin-page'
import { apiFetch } from '@/lib/api-client'

type UserRow = {
  id: string
  username: string
  email: string | null
  displayName: string | null
  role: string
  status: number
  pointsBalance: number
  walletAddress: string | null
  createdAt: string
  currentMembership: {
    id: string
    name: string
    rank: number
    expiresAt: string | null
  } | null
}

type UserFormValues = {
  username: string
  email?: string
  displayName?: string
  password?: string
  confirmPassword?: string
  status: number
}

type PasswordFormValues = {
  password: string
  confirmPassword: string
}

type MembershipFormValues = {
  membershipLevelId: string
  expiresAt?: string
}

type MembershipLevel = {
  id: string
  name: string
  rank: number
  pricePoints: number
  validityDays: number | null
  status: number
}

type UserMembershipData = {
  currentMembership: UserRow['currentMembership']
  grants: Array<{
    id: string
    membershipLevel: MembershipLevel
    grantedAt: string
    expiresAt: string | null
    revokedAt: string | null
    active: boolean
  }>
}

export function UsersManager() {
  const t = useTranslations('AdminMM.users')
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [adjusting, setAdjusting] = useState<UserRow | null>(null)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [resettingPassword, setResettingPassword] = useState<UserRow | null>(null)
  const [managingMembership, setManagingMembership] = useState<UserRow | null>(null)
  const [membershipPermanent, setMembershipPermanent] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [pointsForm] = Form.useForm<{ amount: number; description: string }>()
  const [userForm] = Form.useForm<UserFormValues>()
  const [passwordForm] = Form.useForm<PasswordFormValues>()
  const [membershipForm] = Form.useForm<MembershipFormValues>()

  const query = useQuery({
    queryKey: ['admin-users', page, pageSize, keyword],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (keyword) params.set('keyword', keyword)
      return apiFetch<{ list: UserRow[]; total: number }>(`/api/admin/mm/users?${params}`)
    },
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] })
  const membershipLevelsQuery = useQuery({
    queryKey: ['admin-membership-levels'],
    queryFn: () => apiFetch<MembershipLevel[]>('/api/admin/mm/membership-levels?includeDisabled=1'),
  })
  const membershipQuery = useQuery({
    queryKey: ['admin-user-membership', managingMembership?.id],
    enabled: Boolean(managingMembership),
    queryFn: () => apiFetch<UserMembershipData>(`/api/admin/mm/users/${managingMembership!.id}/membership`),
  })

  const pointsMutation = useMutation({
    mutationFn: (values: { amount: number; description: string }) =>
      apiFetch('/api/admin/mm/users/points', {
        method: 'POST',
        body: JSON.stringify({ ...values, userId: Number(adjusting!.id) }),
      }),
    onSuccess: async () => {
      message.success(t('messages.adjustedPoints'))
      setAdjusting(null)
      pointsForm.resetFields()
      await refresh()
    },
    onError: (error) => message.error(error.message),
  })

  const saveUserMutation = useMutation({
    mutationFn: (values: UserFormValues) => {
      if (editing) {
        return apiFetch<UserRow>(`/api/admin/mm/users/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            username: values.username,
            email: values.email || null,
            displayName: values.displayName || null,
            status: values.status,
          }),
        })
      }
      return apiFetch<UserRow>('/api/admin/mm/users', {
        method: 'POST',
        body: JSON.stringify({
          username: values.username,
          email: values.email || undefined,
          displayName: values.displayName || undefined,
          password: values.password,
        }),
      })
    },
    onSuccess: async () => {
      message.success(editing ? t('messages.saved') : t('messages.created'))
      setFormOpen(false)
      setEditing(null)
      userForm.resetFields()
      await refresh()
    },
    onError: (error) => message.error(error.message),
  })

  const passwordMutation = useMutation({
    mutationFn: (values: PasswordFormValues) =>
      apiFetch<{ signedOut: boolean }>(`/api/admin/mm/users/${resettingPassword!.id}/password`, {
        method: 'POST',
        body: JSON.stringify({ password: values.password }),
      }),
    onSuccess: async ({ signedOut }) => {
      setResettingPassword(null)
      passwordForm.resetFields()
      if (signedOut) {
        message.success(t('messages.signedOut'))
        window.location.assign('/admin/auth/login')
        return
      }
      message.success(t('messages.passwordReset'))
      await refresh()
    },
    onError: (error) => message.error(error.message),
  })

  const membershipMutation = useMutation({
    mutationFn: (values: MembershipFormValues) => apiFetch<UserMembershipData>(
      `/api/admin/mm/users/${managingMembership!.id}/membership`,
      {
        method: 'PUT',
        body: JSON.stringify({
          membershipLevelId: Number(values.membershipLevelId),
          expiresAt: membershipPermanent ? null : new Date(values.expiresAt!).toISOString(),
        }),
      },
    ),
    onSuccess: async () => {
      message.success('会员权益已设置')
      membershipForm.resetFields()
      setMembershipPermanent(false)
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: ['admin-user-membership', managingMembership?.id] }),
      ])
    },
    onError: (error) => message.error(error.message),
  })
  const revokeMembershipMutation = useMutation({
    mutationFn: () => apiFetch<UserMembershipData>(`/api/admin/mm/users/${managingMembership!.id}/membership`, { method: 'DELETE' }),
    onSuccess: async () => {
      message.success('会员权益已取消')
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: ['admin-user-membership', managingMembership?.id] }),
      ])
    },
    onError: (error) => message.error(error.message),
  })

  const openCreate = () => {
    setEditing(null)
    userForm.setFieldsValue({ username: '', email: '', displayName: '', password: '', confirmPassword: '', status: 1 })
    setFormOpen(true)
  }
  const openEdit = (user: UserRow) => {
    setEditing(user)
    userForm.setFieldsValue({
      username: user.username,
      email: user.email || '',
      displayName: user.displayName || '',
      status: user.status,
      password: '',
      confirmPassword: '',
    })
    setFormOpen(true)
  }
  const openPasswordReset = (user: UserRow) => {
    setResettingPassword(user)
    passwordForm.resetFields()
  }
  const openMembership = (user: UserRow) => {
    setManagingMembership(user)
    setMembershipPermanent(false)
    membershipForm.resetFields()
  }
  const confirmDisable = (user: UserRow) => {
    modal.confirm({
      title: t('messages.deleteConfirmTitle'),
      content: (
        <Space direction="vertical" size={4}>
          <span>{t('messages.deleteConfirm', { name: user.displayName || user.username })}</span>
          <span>{t('messages.deleteNotice')}</span>
        </Space>
      ),
      okText: t('operations.delete'),
      okButtonProps: { danger: true },
      cancelText: t('dialog.cancel'),
      onOk: async () => {
        await apiFetch(`/api/admin/mm/users/${user.id}`, { method: 'DELETE' })
        message.success(t('messages.deleted'))
        await refresh()
      },
    })
  }

  return (
    <AdminPage>
      <AdminPageActions>
        <Space>
          <Button icon={<RefreshCw size={15} />} onClick={() => void query.refetch()}>{t('actions.refresh')}</Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={openCreate}>{t('actions.create')}</Button>
        </Space>
      </AdminPageActions>

      <AdminToolbar>
        <Input.Search
          allowClear
          value={keyword}
          prefix={<Search size={14} />}
          placeholder={t('filters.keyword')}
          onChange={(event) => setKeyword(event.target.value)}
          onSearch={() => setPage(1)}
        />
      </AdminToolbar>

      <AdminTablePanel>
        <Table<UserRow>
          rowKey="id"
          loading={query.isLoading}
          dataSource={query.data?.list || []}
          pagination={{
            current: page,
            pageSize,
            total: query.data?.total || 0,
            showSizeChanger: true,
            onChange: (nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize) },
          }}
          columns={[
            {
              title: t('table.user'),
              minWidth: 180,
              render: (_value, user) => (
                <Space>
                  <UserRound size={17} />
                  <span><strong>{user.displayName || user.username}</strong><br /><small>@{user.username}</small></span>
                </Space>
              ),
            },
            { title: t('table.email'), dataIndex: 'email', render: (value) => value || '—' },
            {
              title: t('table.role'),
              dataIndex: 'role',
              width: 96,
              render: (value) => value === 'ADMIN' ? <Tag color="blue">{t('role.admin')}</Tag> : t('role.user'),
            },
            { title: t('table.wallet'), dataIndex: 'walletAddress', width: 100, render: (value) => value ? t('wallet.bound') : t('wallet.unbound') },
            { title: t('table.points'), dataIndex: 'pointsBalance', width: 100, align: 'right' },
            {
              title: '会员等级',
              dataIndex: 'currentMembership',
              width: 170,
              render: (value: UserRow['currentMembership']) => value
                ? <span><Tag color="gold">Lv.{value.rank}</Tag>{value.name}<br /><small>{value.expiresAt ? `至 ${new Date(value.expiresAt).toLocaleDateString()}` : '永久有效'}</small></span>
                : <Tag>普通用户</Tag>,
            },
            {
              title: t('table.status'),
              dataIndex: 'status',
              width: 100,
              render: (value) => value === 1
                ? <Tag color="success">{t('status.active')}</Tag>
                : <Tag color="warning">{t('status.disabled')}</Tag>,
            },
            { title: t('table.createdAt'), dataIndex: 'createdAt', width: 170, render: (value) => new Date(value).toLocaleString() },
            {
              title: t('table.operations'),
              fixed: 'right',
              width: 350,
              render: (_value, user) => (
                <Space size={4}>
                  <Button type="link" icon={<Pencil size={14} />} onClick={() => openEdit(user)}>{t('operations.edit')}</Button>
                  <Button type="link" icon={<KeyRound size={14} />} onClick={() => openPasswordReset(user)}>{t('operations.password')}</Button>
                  <Button type="link" icon={<Coins size={14} />} onClick={() => setAdjusting(user)}>{t('operations.points')}</Button>
                  <Button type="link" icon={<Crown size={14} />} onClick={() => openMembership(user)}>会员</Button>
                  {user.role !== 'ADMIN' && user.status === 1 ? (
                    <Button danger type="link" icon={<Trash2 size={14} />} onClick={() => confirmDisable(user)}>{t('operations.delete')}</Button>
                  ) : null}
                </Space>
              ),
            },
          ]}
        />
      </AdminTablePanel>

      <Modal
        open={formOpen}
        title={editing ? t('dialog.editTitle') : t('dialog.createTitle')}
        okText={t('dialog.save')}
        cancelText={t('dialog.cancel')}
        confirmLoading={saveUserMutation.isPending}
        onCancel={() => setFormOpen(false)}
        onOk={() => userForm.submit()}
      >
        <Form form={userForm} layout="vertical" onFinish={(values) => saveUserMutation.mutate(values)}>
          <Form.Item
            name="username"
            label={t('dialog.username')}
            rules={[{ required: true }, { pattern: /^[A-Za-z0-9_]{3,32}$/, message: t('validation.username') }]}
          >
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item name="displayName" label={t('dialog.displayName')}>
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item name="email" label={t('dialog.email')} rules={[{ type: 'email', message: t('validation.email') }]}>
            <Input autoComplete="email" />
          </Form.Item>
          {!editing ? (
            <>
              <Form.Item name="password" label={t('dialog.password')} rules={[{ required: true }, { min: 8, message: t('validation.password') }]}>
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                name="confirmPassword"
                label={t('dialog.confirmPassword')}
                dependencies={['password']}
                rules={[{ required: true }, ({ getFieldValue }) => ({
                  validator: async (_, value) => {
                    if (value === getFieldValue('password')) return
                    throw new Error(t('validation.confirmPassword'))
                  },
                })]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
            </>
          ) : null}
          {editing ? (
            <Form.Item name="status" label={t('dialog.status')}>
              <Select
                disabled={editing.role === 'ADMIN'}
                options={[
                  { value: 1, label: t('status.active') },
                  { value: 0, label: t('status.disabled') },
                ]}
              />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>

      <Modal
        open={Boolean(managingMembership)}
        title={`会员权益 · ${managingMembership?.displayName || managingMembership?.username || ''}`}
        okText="设置会员"
        cancelText="关闭"
        confirmLoading={membershipMutation.isPending}
        onCancel={() => { setManagingMembership(null); membershipForm.resetFields(); setMembershipPermanent(false) }}
        onOk={() => membershipForm.submit()}
        footer={(_origin, { OkBtn, CancelBtn }) => <Space><Button danger loading={revokeMembershipMutation.isPending} onClick={() => revokeMembershipMutation.mutate()}>取消全部权益</Button><CancelBtn /><OkBtn /></Space>}
      >
        <Space direction="vertical" size={12} className="full-width">
          <div>
            <strong>当前权益：</strong>{membershipQuery.data?.currentMembership ? <Tag color="gold">Lv.{membershipQuery.data.currentMembership.rank} {membershipQuery.data.currentMembership.name}</Tag> : '普通用户'}
          </div>
          <Form form={membershipForm} layout="vertical" onFinish={(values) => membershipMutation.mutate(values)}>
            <Form.Item name="membershipLevelId" label="授予等级" rules={[{ required: true, message: '请选择会员等级' }]}>
              <Select loading={membershipLevelsQuery.isLoading} options={(membershipLevelsQuery.data || []).map((level) => ({ value: level.id, label: `Lv.${level.rank} · ${level.name}${level.status === 0 ? '（已停用）' : ''}` }))} />
            </Form.Item>
            <Form.Item label="永久有效" valuePropName="checked">
              <Switch checked={membershipPermanent} onChange={setMembershipPermanent} />
            </Form.Item>
            {!membershipPermanent ? (
              <Form.Item name="expiresAt" label="到期时间" rules={[{ required: true, message: '请选择未来到期时间' }]}>
                <Input type="datetime-local" />
              </Form.Item>
            ) : null}
          </Form>
          <div className="admin-membership-history">
            <strong>授权记录</strong>
            {membershipQuery.data?.grants.map((grant) => <div key={grant.id}><Tag color={grant.active ? 'success' : undefined}>Lv.{grant.membershipLevel.rank} {grant.membershipLevel.name}</Tag>{grant.revokedAt ? '已取消' : grant.expiresAt ? `至 ${new Date(grant.expiresAt).toLocaleString()}` : '永久有效'}</div>)}
          </div>
        </Space>
      </Modal>

      <Modal
        open={Boolean(resettingPassword)}
        title={t('dialog.passwordTitle', { name: resettingPassword?.displayName || resettingPassword?.username || '' })}
        okText={t('dialog.resetPassword')}
        cancelText={t('dialog.cancel')}
        confirmLoading={passwordMutation.isPending}
        onCancel={() => setResettingPassword(null)}
        onOk={() => passwordForm.submit()}
      >
        <Form form={passwordForm} layout="vertical" onFinish={(values) => passwordMutation.mutate(values)}>
          <Form.Item name="password" label={t('dialog.password')} rules={[{ required: true }, { min: 8, message: t('validation.password') }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label={t('dialog.confirmPassword')}
            dependencies={['password']}
            rules={[{ required: true }, ({ getFieldValue }) => ({
              validator: async (_, value) => {
                if (value === getFieldValue('password')) return
                throw new Error(t('validation.confirmPassword'))
              },
            })]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(adjusting)}
        title={`${t('operations.points')} · ${adjusting?.displayName || adjusting?.username || ''}`}
        okText={t('operations.points')}
        cancelText={t('dialog.cancel')}
        confirmLoading={pointsMutation.isPending}
        onCancel={() => setAdjusting(null)}
        onOk={() => pointsForm.submit()}
      >
        <Form form={pointsForm} layout="vertical" onFinish={(values) => pointsMutation.mutate(values)}>
          <Form.Item
            name="amount"
            label={t('points.amount')}
            rules={[{ required: true }, { validator: async (_, value) => value === 0 ? Promise.reject(new Error(t('points.nonZero'))) : undefined }]}
          >
            <InputNumber min={-1000000} max={1000000} className="full-width" placeholder={t('points.placeholder')} />
          </Form.Item>
          <Form.Item name="description" label={t('points.description')} rules={[{ required: true, min: 2, max: 255 }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </AdminPage>
  )
}
