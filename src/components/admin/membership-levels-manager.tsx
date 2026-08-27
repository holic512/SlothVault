'use client'

/**
 * @file membership-levels-manager.tsx
 * @project SlothVault
 * @module Membership Level Administration
 * @description Provides the administrator table and editor for point-priced membership levels used by article access rules.
 * @logic Keep rank, price, duration, and sellability explicit; retain disabled levels instead of deleting historical references.
 * @dependencies Ant Design, React Query, admin page layout, membership-level API
 * @index_tags admin,membership,level,crud,points
 * @author holic512
 */
import { useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography } from 'antd'
import { Coins, Crown, Pencil, Plus, RefreshCw } from 'lucide-react'

import { AdminPage, AdminPageActions, AdminTablePanel } from '@/components/admin/admin-page'
import { apiFetch } from '@/lib/api-client'

type MembershipLevel = {
  id: string
  name: string
  rank: number
  pricePoints: number
  validityDays: number | null
  status: number
  createdAt: string
  updatedAt: string
}

type LevelForm = {
  name: string
  rank: number
  pricePoints: number
  validityDays?: number
  status: number
}

export function MembershipLevelsManager() {
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [editing, setEditing] = useState<MembershipLevel | null>(null)
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm<LevelForm>()
  const levelsQuery = useQuery({
    queryKey: ['admin-membership-levels'],
    queryFn: () => apiFetch<MembershipLevel[]>('/api/admin/mm/membership-levels?includeDisabled=1'),
  })
  const saveMutation = useMutation({
    mutationFn: (values: LevelForm) => {
      const body = {
        ...values,
        validityDays: values.validityDays || null,
      }
      return apiFetch<MembershipLevel>(
        editing ? `/api/admin/mm/membership-levels/${editing.id}` : '/api/admin/mm/membership-levels',
        { method: editing ? 'PUT' : 'POST', body: JSON.stringify(body) },
      )
    },
    onSuccess: async () => {
      message.success(editing ? '会员等级已更新' : '会员等级已创建')
      setOpen(false)
      setEditing(null)
      form.resetFields()
      await queryClient.invalidateQueries({ queryKey: ['admin-membership-levels'] })
      await queryClient.invalidateQueries({ queryKey: ['admin-articles'] })
    },
    onError: (error) => message.error(error.message),
  })

  const openCreate = () => {
    setEditing(null)
    form.setFieldsValue({ name: '', rank: undefined, pricePoints: undefined, validityDays: undefined, status: 1 })
    setOpen(true)
  }
  const openEdit = (level: MembershipLevel) => {
    setEditing(level)
    form.setFieldsValue({
      name: level.name,
      rank: level.rank,
      pricePoints: level.pricePoints,
      validityDays: level.validityDays ?? undefined,
      status: level.status,
    })
    setOpen(true)
  }

  return (
    <AdminPage>
      <AdminPageActions>
        <Space>
          <Button icon={<RefreshCw size={15} />} loading={levelsQuery.isFetching} onClick={() => void levelsQuery.refetch()}>刷新</Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={openCreate}>新建会员等级</Button>
        </Space>
      </AdminPageActions>

      <AdminTablePanel>
        <Table<MembershipLevel>
          rowKey="id"
          loading={levelsQuery.isLoading}
          dataSource={levelsQuery.data || []}
          pagination={false}
          scroll={{ x: 760 }}
          columns={[
            { title: '等级', dataIndex: 'name', render: (_value, level) => <Space><Tag color="gold"><Crown size={13} />Lv.{level.rank}</Tag><Typography.Text strong>{level.name}</Typography.Text></Space> },
            { title: '排序值', dataIndex: 'rank', width: 100 },
            { title: '积分价格', dataIndex: 'pricePoints', width: 130, align: 'right', render: (value) => <Space size={3}><Coins size={14} />{value}</Space> },
            { title: '有效期', dataIndex: 'validityDays', width: 130, render: (value) => value ? `${value} 天` : '永久有效' },
            { title: '状态', dataIndex: 'status', width: 110, render: (value) => value === 1 ? <Tag color="success">可购买</Tag> : <Tag>已停用</Tag> },
            { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: (value) => new Date(value).toLocaleString() },
            { title: '操作', fixed: 'right', width: 100, render: (_value, level) => <Button type="link" icon={<Pencil size={14} />} onClick={() => openEdit(level)}>编辑</Button> },
          ]}
        />
      </AdminTablePanel>

      <Modal
        open={open}
        title={editing ? '编辑会员等级' : '新建会员等级'}
        okText="保存"
        cancelText="取消"
        confirmLoading={saveMutation.isPending}
        onCancel={() => { setOpen(false); setEditing(null) }}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)}>
          <Form.Item name="name" label="等级名称" rules={[{ required: true, max: 80 }]}><Input maxLength={80} /></Form.Item>
          <Form.Item name="rank" label="排序值（越高权限越高）" rules={[{ required: true }]}><InputNumber min={1} max={32767} className="full-width" /></Form.Item>
          <Form.Item name="pricePoints" label="积分价格" rules={[{ required: true }]}><InputNumber min={1} max={1000000} className="full-width" /></Form.Item>
          <Form.Item name="validityDays" label="有效天数（留空表示永久）"><InputNumber min={1} max={36500} className="full-width" /></Form.Item>
          <Form.Item name="status" label="销售状态"><Select options={[{ value: 1, label: '可购买' }, { value: 0, label: '已停用（保留现有权益）' }]} /></Form.Item>
        </Form>
      </Modal>
    </AdminPage>
  )
}
