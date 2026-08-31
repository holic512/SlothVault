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
import { useLocale, useTranslations } from 'next-intl'

import { AdminPage, AdminPageActions, AdminTablePanel } from '@/components/admin/admin-page'
import { formatAdminDate, formatAdminError, formatAdminNumber } from '@/lib/admin-localization'
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
  const t = useTranslations('AdminMM.membershipLevels')
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
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
      message.success(editing ? t('messages.updated') : t('messages.created'))
      setOpen(false)
      setEditing(null)
      form.resetFields()
      await queryClient.invalidateQueries({ queryKey: ['admin-membership-levels'] })
      await queryClient.invalidateQueries({ queryKey: ['admin-articles'] })
    },
    onError: (error) => message.error(formatAdminError(error, errorT)),
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
          <Button icon={<RefreshCw size={15} />} loading={levelsQuery.isFetching} onClick={() => void levelsQuery.refetch()}>{t('actions.refresh')}</Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={openCreate}>{t('actions.create')}</Button>
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
            { title: t('table.level'), dataIndex: 'name', render: (_value, level) => <Space><Tag color="gold"><Crown size={13} />{t('level', { rank: level.rank })}</Tag><Typography.Text strong>{level.name}</Typography.Text></Space> },
            { title: t('table.rank'), dataIndex: 'rank', width: 100 },
            { title: t('table.pricePoints'), dataIndex: 'pricePoints', width: 130, align: 'right', render: (value) => <Space size={3}><Coins size={14} />{formatAdminNumber(locale, value)}</Space> },
            { title: t('table.validity'), dataIndex: 'validityDays', width: 130, render: (value) => value ? t('validityDays', { count: formatAdminNumber(locale, value) }) : t('permanent') },
            { title: t('table.status'), dataIndex: 'status', width: 110, render: (value) => value === 1 ? <Tag color="success">{t('status.available')}</Tag> : <Tag>{t('status.disabled')}</Tag> },
            { title: t('table.updatedAt'), dataIndex: 'updatedAt', width: 170, render: (value) => formatAdminDate(locale, value) },
            { title: t('table.operations'), fixed: 'right', width: 100, render: (_value, level) => <Button type="link" icon={<Pencil size={14} />} onClick={() => openEdit(level)}>{t('actions.edit')}</Button> },
          ]}
        />
      </AdminTablePanel>

      <Modal
        open={open}
        title={editing ? t('dialog.editTitle') : t('dialog.createTitle')}
        okText={t('actions.save')}
        cancelText={t('actions.cancel')}
        confirmLoading={saveMutation.isPending}
        onCancel={() => { setOpen(false); setEditing(null) }}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)}>
          <Form.Item name="name" label={t('form.name')} rules={[{ required: true, max: 80 }]}><Input maxLength={80} /></Form.Item>
          <Form.Item name="rank" label={t('form.rank')} rules={[{ required: true }]}><InputNumber min={1} max={32767} className="full-width" /></Form.Item>
          <Form.Item name="pricePoints" label={t('form.pricePoints')} rules={[{ required: true }]}><InputNumber min={1} max={1000000} className="full-width" /></Form.Item>
          <Form.Item name="validityDays" label={t('form.validityDays')}><InputNumber min={1} max={36500} className="full-width" /></Form.Item>
          <Form.Item name="status" label={t('form.status')}><Select options={[{ value: 1, label: t('status.available') }, { value: 0, label: t('status.disabledWithRetention') }]} /></Form.Item>
        </Form>
      </Modal>
    </AdminPage>
  )
}
