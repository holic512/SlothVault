'use client'

/**
 * @file users-manager.tsx
 * @project SlothVault
 * @module User Administration
 * @description Provides administrator-managed user creation, profile and access updates, true account deletion and independent audit history, password resets, and point adjustments.
 * @logic Query bounded user pages with inline search, access filters and a deleted-user toggle, keep credentials private, submit protected identity mutations, and retain session revocation and point ledgers.
 * @dependencies Ant Design, React Query, next-intl, admin user APIs
 * @index_tags admin,users,crud,password,points,ledger
 * @author holic512
 */
import { useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd'
import { Ban, Check, Coins, Crown, KeyRound, Pencil, Plus, RefreshCw, Search, Trash2, UserRound } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { AdminPage, AdminPageActions, AdminTablePanel, AdminToolbar } from '@/components/admin/admin-page'
import { formatAdminDate, formatAdminError } from '@/lib/admin-localization'
import { replaceClientSession } from '@/lib/session-client'
import { apiFetch } from '@/lib/api-client'
import type { AccountDeletionPreview, DeletedUserRow } from '@/types/admin-users'
import type { SessionUser } from '@/types/user'

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
  activeMemberships: Array<{
    id: string
    name: string
    rank: number
    expiresAt: string | null
  }>
}

type UserFormValues = {
  username: string
  email?: string
  displayName?: string
  password?: string
  confirmPassword?: string
  status: number
  role: 'ADMIN' | 'USER'
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
  activeMemberships: UserRow['activeMemberships']
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
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [view, setView] = useState('live')
  const [roleFilter, setRoleFilter] = useState<string>()
  const [statusFilter, setStatusFilter] = useState<number>()
  const [deleting, setDeleting] = useState<UserRow | null>(null)
  const [historyRecord, setHistoryRecord] = useState<DeletedUserRow | null>(null)
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
    queryKey: ['admin-users', page, pageSize, keyword, roleFilter, statusFilter],
    enabled: view === 'live',
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (keyword) params.set('keyword', keyword)
      if (roleFilter) params.set('role', roleFilter)
      if (statusFilter !== undefined) params.set('status', String(statusFilter))
      return apiFetch<{ list: UserRow[]; total: number }>(`/api/admin/mm/users?${params}`)
    },
  })
  const sessionQuery = useQuery({ queryKey: ['session-user'], queryFn: () => apiFetch<SessionUser | null>('/api/auth/session') })
  const historyQuery = useQuery({
    queryKey: ['admin-users', 'deleted', page, pageSize, keyword], enabled: view === 'deleted',
    queryFn: () => apiFetch<{ list: DeletedUserRow[]; total: number }>(`/api/admin/mm/users/deleted?${new URLSearchParams({ page: String(page), pageSize: String(pageSize), keyword })}`),
  })
  const deletionPreview = useQuery({
    queryKey: ['admin-users', 'deletion-preview', deleting?.id], enabled: Boolean(deleting),
    queryFn: () => apiFetch<AccountDeletionPreview>(`/api/admin/mm/users/${deleting!.id}/deletion-preview`),
    staleTime: 0,
  })
  const deletionMutation = useMutation({
    mutationFn: () => apiFetch(`/api/admin/mm/users/${deleting!.id}`, { method: 'DELETE' }),
    onSuccess: async () => { message.success(t('messages.deleted')); setDeleting(null); await refresh() },
    onError: async error => { message.error(formatAdminError(error, errorT)); await deletionPreview.refetch() },
  })
  const accessMutation = useMutation({
    mutationFn: (user: UserRow) => apiFetch(`/api/admin/mm/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ status: user.status === 1 ? 0 : 1 }) }),
    onSuccess: async () => { message.success(t('messages.accessUpdated')); await refresh() },
    onError: error => message.error(formatAdminError(error, errorT)),
  })
  const totalRecords = (values: Record<string, number> = {}) => Object.values(values).reduce((sum, value) => sum + value, 0)
  const cleanupLabels: Record<string, string> = {
    sessions: t('deletion.records.sessions'), wallets: t('deletion.records.wallets'), mcpApiKeys: t('deletion.records.keys'), pointTransactions: t('deletion.records.points'),
    membershipGrants: t('deletion.records.memberships'), giftCardRedemptions: t('deletion.records.redemptions'), avatarReferences: t('deletion.records.avatar'),
  }
  const renderCleanupDetails = (counts: Record<string, number>) => <Space orientation="vertical" size={2}>
    {Object.entries(counts).filter(([, count]) => count > 0).map(([key, count]) => <Typography.Text key={key}>{cleanupLabels[key]}：{count}</Typography.Text>)}
  </Space>
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
    onError: (error) => message.error(formatAdminError(error, errorT)),
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
            role: values.role,
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
          role: values.role,
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
    onError: (error) => message.error(formatAdminError(error, errorT)),
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
        await replaceClientSession(queryClient, null)
        window.location.assign('/login?next=/admin/mm')
        return
      }
      message.success(t('messages.passwordReset'))
      await refresh()
    },
    onError: (error) => message.error(formatAdminError(error, errorT)),
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
      message.success(t('messages.membershipSet'))
      membershipForm.resetFields()
      setMembershipPermanent(false)
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: ['admin-user-membership', managingMembership?.id] }),
      ])
    },
    onError: (error) => message.error(formatAdminError(error, errorT)),
  })
  const revokeMembershipMutation = useMutation({
    mutationFn: (membershipLevelId?: string) => apiFetch<UserMembershipData>(`/api/admin/mm/users/${managingMembership!.id}/membership?${membershipLevelId ? `membershipLevelId=${membershipLevelId}` : 'all=true'}`, { method: 'DELETE' }),
    onSuccess: async () => {
      message.success(t('messages.membershipRevoked'))
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: ['admin-user-membership', managingMembership?.id] }),
      ])
    },
    onError: (error) => message.error(formatAdminError(error, errorT)),
  })

  const openCreate = () => {
    setEditing(null)
    userForm.setFieldsValue({ username: '', email: '', displayName: '', password: '', confirmPassword: '', status: 1, role: 'USER' })
    setFormOpen(true)
  }
  const openEdit = (user: UserRow) => {
    setEditing(user)
    userForm.setFieldsValue({
      username: user.username,
      email: user.email || '',
      displayName: user.displayName || '',
      status: user.status,
      role: user.role as UserFormValues['role'],
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
  const confirmAccessChange = (user: UserRow) => {
    if (user.status === 0) { accessMutation.mutate(user); return }
    modal.confirm({ title: t('operations.disable'), content: t('messages.disableNotice'), okButtonProps: { danger: true }, onOk: () => accessMutation.mutateAsync(user) })
  }

  return (
    <AdminPage className="admin-users-page">
      <AdminPageActions>
        <Space>
          <Button icon={<RefreshCw size={15} />} onClick={() => void (view === 'live' ? query.refetch() : historyQuery.refetch())}>{t('actions.refresh')}</Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={openCreate}>{t('actions.create')}</Button>
        </Space>
      </AdminPageActions>

      <AdminToolbar className="admin-users-toolbar">
        <Input.Search
          className="admin-users-search"
          allowClear
          value={keyword}
          prefix={<Search size={14} />}
          aria-label={view === 'deleted' ? t('history.keyword') : t('filters.keyword')}
          placeholder={view === 'deleted' ? t('history.keyword') : t('filters.keyword')}
          onChange={(event) => { setKeyword(event.target.value); setPage(1) }}
          onSearch={() => setPage(1)}
        />
        <div className="admin-users-filters">
          {view === 'live' ? <>
            <Select className="admin-users-filter" allowClear value={roleFilter} aria-label={t('filters.role')} placeholder={t('filters.role')} onChange={value => { setRoleFilter(value); setPage(1) }} options={[{ value: 'ADMIN', label: t('role.admin') }, { value: 'USER', label: t('role.user') }]} />
            <Select className="admin-users-filter" allowClear value={statusFilter} aria-label={t('filters.status')} placeholder={t('filters.status')} onChange={value => { setStatusFilter(value); setPage(1) }} options={[{ value: 1, label: t('status.active') }, { value: 0, label: t('status.disabled') }]} />
          </> : null}
          <label className="admin-switch-label admin-users-deleted-toggle">
            <Switch size="small" checked={view === 'deleted'} aria-label={t('filters.showDeleted')} onChange={checked => { setView(checked ? 'deleted' : 'live'); setPage(1) }} />
            {t('filters.showDeleted')}
          </label>
        </div>
      </AdminToolbar>

      {view === 'live' && query.isError ? <Alert type="error" title={formatAdminError(query.error, errorT)} /> : null}
      {view === 'deleted' && historyQuery.isError ? <Alert type="error" title={formatAdminError(historyQuery.error, errorT)} /> : null}
      <AdminTablePanel>
        {view === 'live' ? <Table<UserRow>
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
                <Space className="admin-user-identity" align="center">
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
              render: (value) => <Tag color={value === 'ADMIN' ? 'purple' : 'blue'}>{value === 'ADMIN' ? t('role.admin') : t('role.user')}</Tag>,
            },
            { title: t('table.wallet'), dataIndex: 'walletAddress', width: 100, render: (value) => value ? t('wallet.bound') : t('wallet.unbound') },
            { title: t('table.points'), dataIndex: 'pointsBalance', width: 100, align: 'right' },
            {
              title: t('table.membership'),
              dataIndex: 'activeMemberships',
              width: 170,
              render: (value: UserRow['activeMemberships']) => value?.length
                ? <Space orientation="vertical" size={2}>{value.map((item) => <span key={item.id}><Tag color="purple">{item.name}</Tag><small>{item.expiresAt ? t('membership.until', { date: formatAdminDate(locale, item.expiresAt, false) }) : t('membership.permanent')}</small></span>)}</Space>
                : <Tag color="blue">{t('membership.regular')}</Tag>,
            },
            {
              title: t('table.status'),
              dataIndex: 'status',
              width: 100,
              render: (value) => value === 1
                ? <Tag color="success">{t('status.active')}</Tag>
                : <Tag color="warning">{t('status.disabled')}</Tag>,
            },
            { title: t('table.createdAt'), dataIndex: 'createdAt', width: 170, render: (value) => formatAdminDate(locale, value) },
            {
              title: t('table.operations'),
              fixed: 'right',
              width: 230,
              render: (_value, user) => (
                <Space className="admin-user-operations" size={4}>
                  <Tooltip title={t('operations.edit')}>
                    <Button type="link" aria-label={t('operations.edit')} icon={<Pencil size={14} />} onClick={() => openEdit(user)} />
                  </Tooltip>
                  <Tooltip title={t('operations.password')}>
                    <Button type="link" aria-label={t('operations.password')} icon={<KeyRound size={14} />} onClick={() => openPasswordReset(user)} />
                  </Tooltip>
                  <Tooltip title={t('operations.points')}>
                    <Button type="link" aria-label={t('operations.points')} icon={<Coins size={14} />} onClick={() => setAdjusting(user)} />
                  </Tooltip>
                  <Tooltip title={t('operations.membership')}>
                    <Button type="link" aria-label={t('operations.membership')} icon={<Crown size={14} />} onClick={() => openMembership(user)} />
                  </Tooltip>
                  <Tooltip title={user.status === 1 ? t('operations.disable') : t('operations.enable')}>
                    <Button type="link" disabled={user.id === sessionQuery.data?.id} aria-label={user.status === 1 ? t('operations.disable') : t('operations.enable')} icon={user.status === 1 ? <Ban size={14} /> : <Check size={14} />} onClick={() => confirmAccessChange(user)} />
                  </Tooltip>
                  <Tooltip title={t('operations.delete')}>
                    <Button danger type="link" disabled={user.id === sessionQuery.data?.id} aria-label={t('operations.delete')} icon={<Trash2 size={14} />} onClick={() => setDeleting(user)} />
                  </Tooltip>
                </Space>
              ),
            },
          ]}
        /> : <Table<DeletedUserRow>
          rowKey="id" loading={historyQuery.isLoading} dataSource={historyQuery.data?.list || []}
          pagination={{ current: page, pageSize, total: historyQuery.data?.total || 0, showSizeChanger: true, onChange: (next, size) => { setPage(next); setPageSize(size) } }}
          columns={[
            { title: t('table.user'), render: (_, row) => <span><strong>{row.user.displayName || row.user.username}</strong><br /><small>@{row.user.username}</small></span> },
            { title: t('table.role'), render: (_, row) => row.user.role === 'ADMIN' ? t('role.admin') : t('role.user') },
            { title: t('table.createdAt'), render: (_, row) => formatAdminDate(locale, row.createdAt) },
            { title: t('history.deletedAt'), render: (_, row) => formatAdminDate(locale, row.deletedAt) },
            { title: t('history.actor'), render: (_, row) => row.actor.displayName || row.actor.username },
            { title: t('history.summary'), render: (_, row) => <Button type="link" onClick={() => setHistoryRecord(row)}>{t('history.details')}</Button> },
          ]}
        />}
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
          <Form.Item name="role" label={t('dialog.role')} rules={[{ required: true }]} extra={editing?.id === sessionQuery.data?.id ? t('dialog.currentAdminHint') : t('dialog.roleHint')}>
            <Select disabled={editing?.id === sessionQuery.data?.id} options={[{ value: 'USER', label: t('role.user') }, { value: 'ADMIN', label: t('role.admin') }]} />
          </Form.Item>
          {editing ? (
            <Form.Item name="status" label={t('dialog.status')}>
              <Select
                disabled={editing.id === sessionQuery.data?.id}
                options={[
                  { value: 1, label: t('status.active') },
                  { value: 0, label: t('status.disabled') },
                ]}
              />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>

      <Modal open={Boolean(deleting)} title={t('messages.deleteConfirmTitle')} okText={t('operations.delete')} cancelText={t('dialog.cancel')}
        confirmLoading={deletionMutation.isPending} okButtonProps={{ danger: true, disabled: !deletionPreview.data?.allowed || deletionPreview.isFetching }}
        onCancel={() => setDeleting(null)} onOk={() => deletionMutation.mutate()}>
        <Space orientation="vertical" className="full-width">
          <Typography.Paragraph>{t('messages.deleteConfirm', { name: deleting?.displayName || deleting?.username || '' })}</Typography.Paragraph>
          <Alert type="warning" title={t('messages.deleteNotice')} />
          {deletionPreview.isPending ? <Typography.Text>{t('deletion.loading')}</Typography.Text> : null}
          {deletionPreview.isError ? <Alert type="error" title={formatAdminError(deletionPreview.error, errorT)} action={<Button onClick={() => void deletionPreview.refetch()}>{t('actions.refresh')}</Button>} /> : null}
          {deletionPreview.data?.blockers.map(blocker => <Alert key={blocker.reason} type="error" title={t(`deletion.blockers.${blocker.reason}`, { count: blocker.count })} />)}
          {deletionPreview.data ? <>
            <Typography.Text>{t('deletion.cleanup', { count: totalRecords(deletionPreview.data.cleanup) })}</Typography.Text>
            {renderCleanupDetails(deletionPreview.data.cleanup)}
            <Typography.Text>{t('deletion.retained', { count: totalRecords(deletionPreview.data.retained) })}</Typography.Text>
            <Typography.Text type="secondary">{t('deletion.wallet')}</Typography.Text>
          </> : null}
        </Space>
      </Modal>
      <Modal open={Boolean(historyRecord)} title={t('history.details')} onCancel={() => setHistoryRecord(null)} footer={<Button onClick={() => setHistoryRecord(null)}>{t('membership.close')}</Button>}>
        {historyRecord ? <Space orientation="vertical">
          <Typography.Text>{historyRecord.user.username} · {historyRecord.user.userId}</Typography.Text>
          <Typography.Text>{t('history.actor')}: {historyRecord.actor.username}</Typography.Text>
          <Typography.Text>{t('history.deletedAt')}: {formatAdminDate(locale, historyRecord.deletedAt)}</Typography.Text>
          <Typography.Text>{t('deletion.cleanup', { count: totalRecords(historyRecord.summary.cleanup) })}</Typography.Text>
          {renderCleanupDetails(historyRecord.summary.cleanup)}
          <Typography.Text>{t('deletion.retained', { count: totalRecords(historyRecord.summary.retained) })}</Typography.Text>
          <Typography.Text type="secondary">{t('history.notice')}</Typography.Text>
        </Space> : null}
      </Modal>

      <Modal
        open={Boolean(managingMembership)}
        title={t('membership.dialogTitle', { name: managingMembership?.displayName || managingMembership?.username || '' })}
        okText={t('membership.set')}
        cancelText={t('membership.close')}
        confirmLoading={membershipMutation.isPending}
        onCancel={() => { setManagingMembership(null); membershipForm.resetFields(); setMembershipPermanent(false) }}
        onOk={() => membershipForm.submit()}
        footer={(_origin, { OkBtn, CancelBtn }) => <Space><Button danger loading={revokeMembershipMutation.isPending} onClick={() => modal.confirm({ title: t('membership.revokeAll'), content: t('membership.revokeAllConfirm'), okButtonProps: { danger: true }, onOk: () => revokeMembershipMutation.mutateAsync(undefined) })}>{t('membership.revokeAll')}</Button><CancelBtn /><OkBtn /></Space>}
      >
        <Space orientation="vertical" size={12} className="full-width">
          <div>
            <strong>{t('membership.current')}</strong>
            {membershipQuery.data?.activeMemberships.length ? membershipQuery.data.activeMemberships.map((item) => <span key={item.id}><Tag color="purple">{item.name}</Tag><Button size="small" type="link" danger onClick={() => modal.confirm({ title: t('membership.revokeType', { name: item.name }), content: t('membership.revokeTypeConfirm'), okButtonProps: { danger: true }, onOk: () => revokeMembershipMutation.mutateAsync(item.id) })}>{t('membership.revoke')}</Button></span>) : t('membership.regular')}
          </div>
          <Typography.Text type="secondary">{t('membership.independentHint')}</Typography.Text>
          <Form form={membershipForm} layout="vertical" onFinish={(values) => membershipMutation.mutate(values)}>
            <Form.Item name="membershipLevelId" label={t('membership.grantLevel')} rules={[{ required: true, message: t('membership.selectLevel') }]}>
              <Select loading={membershipLevelsQuery.isLoading} options={(membershipLevelsQuery.data || []).map((level) => ({ value: level.id, label: `${level.name}${level.status === 0 ? ` (${t('membership.disabled')})` : ''}` }))} />
            </Form.Item>
            <Form.Item label={t('membership.permanent')} valuePropName="checked">
              <Switch checked={membershipPermanent} onChange={setMembershipPermanent} />
            </Form.Item>
            {!membershipPermanent ? (
              <Form.Item name="expiresAt" label={t('membership.expiresAt')} rules={[{ required: true, message: t('membership.selectFutureExpiry') }]}>
                <Input type="datetime-local" />
              </Form.Item>
            ) : null}
          </Form>
          <div className="admin-membership-history">
            <strong>{t('membership.history')}</strong>
            {membershipQuery.data?.grants.map((grant) => <div key={grant.id}>
              <Tag color="purple">{grant.membershipLevel.name}</Tag>
              <Tag color={grant.revokedAt ? 'error' : grant.active ? 'success' : 'warning'}>{t(grant.revokedAt ? 'membership.revoked' : grant.active ? 'membership.active' : 'membership.expired')}</Tag>
              {grant.revokedAt ? null : grant.expiresAt ? t('membership.until', { date: formatAdminDate(locale, grant.expiresAt) }) : t('membership.permanent')}
            </div>)}
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
