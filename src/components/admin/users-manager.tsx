'use client'

/**
 * @file users-manager.tsx
 * @project SlothVault
 * @module User Administration
 * @description Lists conventional users and provides auditable administrator point adjustments.
 * @logic Query bounded user pages, keep passwords/sessions private, and submit every non-zero point change with a required ledger description.
 * @dependencies Ant Design, React Query, admin user APIs
 * @index_tags admin,users,points,ledger
 * @author holic512
 */
import { useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, InputNumber, Modal, Space, Table, Typography } from 'antd'
import { Coins, RefreshCw, Search, UserRound } from 'lucide-react'

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
}

export function UsersManager() {
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [adjusting, setAdjusting] = useState<UserRow | null>(null)
  const [form] = Form.useForm<{ amount: number; description: string }>()
  const query = useQuery({
    queryKey: ['admin-users', page, pageSize, keyword],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (keyword) params.set('keyword', keyword)
      return apiFetch<{ list: UserRow[]; total: number }>(`/api/admin/mm/users?${params}`)
    },
  })
  const mutation = useMutation({
    mutationFn: (values: { amount: number; description: string }) =>
      apiFetch('/api/admin/mm/users/points', {
        method: 'POST',
        body: JSON.stringify({ ...values, userId: Number(adjusting!.id) }),
      }),
    onSuccess: async () => {
      message.success('积分已调整并写入流水')
      setAdjusting(null)
      form.resetFields()
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (error) => message.error(error.message),
  })

  return (
    <div className="admin-page-stack">
      <div className="admin-page-heading">
        <div>
          <Typography.Title level={2}>用户管理</Typography.Title>
          <Typography.Paragraph type="secondary">普通账户、管理员身份、钱包绑定与积分余额。</Typography.Paragraph>
        </div>
        <Button icon={<RefreshCw size={15} />} onClick={() => void query.refetch()}>刷新</Button>
      </div>

      <div className="admin-toolbar-card">
        <Input.Search
          allowClear
          value={keyword}
          prefix={<Search size={14} />}
          placeholder="搜索用户名、邮箱或显示名称"
          onChange={(event) => setKeyword(event.target.value)}
          onSearch={() => setPage(1)}
        />
      </div>

      <div className="admin-table-card">
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
              title: '用户',
              minWidth: 180,
              render: (_value, user) => (
                <Space>
                  <UserRound size={17} />
                  <span><strong>{user.displayName || user.username}</strong><br /><small>@{user.username}</small></span>
                </Space>
              ),
            },
            { title: '邮箱', dataIndex: 'email', render: (value) => value || '—' },
            { title: '身份', dataIndex: 'role', width: 90, render: (value) => value === 'ADMIN' ? '管理员' : '用户' },
            { title: '钱包', dataIndex: 'walletAddress', width: 100, render: (value) => value ? '已绑定' : '未绑定' },
            { title: '积分', dataIndex: 'pointsBalance', width: 100, align: 'right' },
            {
              title: '操作',
              width: 120,
              render: (_value, user) => (
                <Button type="link" icon={<Coins size={14} />} onClick={() => setAdjusting(user)}>调整积分</Button>
              ),
            },
          ]}
        />
      </div>

      <Modal
        open={Boolean(adjusting)}
        title={`调整积分 · ${adjusting?.displayName || adjusting?.username || ''}`}
        okText="确认调整"
        cancelText="取消"
        confirmLoading={mutation.isPending}
        onCancel={() => setAdjusting(null)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={(values) => mutation.mutate(values)}>
          <Form.Item
            name="amount"
            label="积分变化"
            rules={[{ required: true }, { validator: async (_, value) => value === 0 ? Promise.reject(new Error('不能为 0')) : undefined }]}
          >
            <InputNumber min={-1000000} max={1000000} className="full-width" placeholder="正数增加，负数扣除" />
          </Form.Item>
          <Form.Item name="description" label="流水说明" rules={[{ required: true, min: 2, max: 255 }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
