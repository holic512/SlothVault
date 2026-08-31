'use client'

/**
 * @file gift-cards-manager.tsx
 * @project SlothVault
 * @module Gift Card Administration
 * @description Issues point-card batches, shows aggregate redemption progress, and exposes plaintext codes exactly once.
 * @logic Submit bounded batch settings, immediately display/copy the one-time plaintext result, then rely on hash-safe aggregate listing for later management.
 * @dependencies Ant Design, React Query, gift-card admin API
 * @index_tags admin,gift-card,issuance,points,codes
 * @author holic512
 */
import { useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, InputNumber, Modal, Progress, Space, Table, Typography } from 'antd'
import { Copy, Plus, RefreshCw } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { AdminPage, AdminPageActions, AdminTablePanel } from '@/components/admin/admin-page'
import { formatAdminDate, formatAdminError, formatAdminNumber } from '@/lib/admin-localization'
import { apiFetch } from '@/lib/api-client'

type BatchRow = {
  id: string
  name: string
  points: number
  quantity: number
  redeemed: number
  status: number
  expiresAt: string | null
  createdBy: string
  createdAt: string
}

type IssueResult = {
  batch: BatchRow
  codes: string[]
}

export function GiftCardsManager() {
  const t = useTranslations('AdminMM.giftCards')
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [createOpen, setCreateOpen] = useState(false)
  const [issuedCodes, setIssuedCodes] = useState<string[]>([])
  const [form] = Form.useForm<{ name: string; points: number; quantity: number; expiresAt?: string }>()
  const query = useQuery({
    queryKey: ['admin-gift-cards', page, pageSize],
    queryFn: () => apiFetch<{ list: BatchRow[]; total: number }>(
      `/api/admin/mm/gift-cards?page=${page}&pageSize=${pageSize}`,
    ),
  })
  const mutation = useMutation({
    mutationFn: (values: ReturnType<typeof form.getFieldsValue>) =>
      apiFetch<IssueResult>('/api/admin/mm/gift-cards', {
        method: 'POST',
        body: JSON.stringify({
          ...values,
          expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null,
        }),
      }),
    onSuccess: async (result) => {
      setCreateOpen(false)
      setIssuedCodes(result.codes)
      form.resetFields()
      await queryClient.invalidateQueries({ queryKey: ['admin-gift-cards'] })
    },
    onError: (error) => message.error(formatAdminError(error, errorT)),
  })

  const copyCodes = async () => {
    await navigator.clipboard.writeText(issuedCodes.join('\n'))
    message.success(t('messages.codesCopied'))
  }

  return (
    <AdminPage>
      <AdminPageActions>
        <Space>
          <Button icon={<RefreshCw size={15} />} onClick={() => void query.refetch()}>{t('actions.refresh')}</Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>{t('actions.create')}</Button>
        </Space>
      </AdminPageActions>

      <AdminTablePanel>
        <Table<BatchRow>
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
            { title: t('table.batch'), dataIndex: 'name', minWidth: 180 },
            { title: t('table.points'), dataIndex: 'points', width: 100, render: (value) => t('pointsValue', { value: formatAdminNumber(locale, value) }) },
            { title: t('table.quantity'), dataIndex: 'quantity', width: 80 },
            {
              title: t('table.redemption'),
              width: 180,
              render: (_value, batch) => (
                <Progress
                  percent={batch.quantity ? Math.round(batch.redeemed / batch.quantity * 100) : 0}
                  format={() => `${batch.redeemed}/${batch.quantity}`}
                  strokeColor="var(--sv-primary)"
                />
              ),
            },
            { title: t('table.expiresAt'), dataIndex: 'expiresAt', width: 180, render: (value) => value ? formatAdminDate(locale, value) : t('permanent') },
            { title: t('table.issuer'), dataIndex: 'createdBy', width: 120 },
          ]}
        />
      </AdminTablePanel>

      <Modal
        open={createOpen}
        title={t('dialog.createTitle')}
        okText={t('actions.generate')}
        cancelText={t('actions.cancel')}
        confirmLoading={mutation.isPending}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" initialValues={{ quantity: 10, points: 100 }} onFinish={(values) => mutation.mutate(values)}>
          <Form.Item name="name" label={t('form.name')} rules={[{ required: true, min: 2 }]}><Input /></Form.Item>
          <div className="admin-form-grid">
            <Form.Item name="points" label={t('form.points')} rules={[{ required: true }]}><InputNumber min={1} max={1000000} className="full-width" /></Form.Item>
            <Form.Item name="quantity" label={t('form.quantity')} rules={[{ required: true }]}><InputNumber min={1} max={500} className="full-width" /></Form.Item>
          </div>
          <Form.Item name="expiresAt" label={t('form.expiresAt')}><Input type="datetime-local" /></Form.Item>
        </Form>
      </Modal>

      <Modal
        open={issuedCodes.length > 0}
        title={t('dialog.codesTitle')}
        okText={t('actions.confirmSaved')}
        cancelButtonProps={{ style: { display: 'none' } }}
        onOk={() => setIssuedCodes([])}
        onCancel={() => setIssuedCodes([])}
      >
        <Typography.Paragraph type="secondary">
          {t('dialog.codesDescription')}
        </Typography.Paragraph>
        <Input.TextArea rows={12} readOnly value={issuedCodes.join('\n')} />
        <Button className="gift-card-copy" block icon={<Copy size={15} />} onClick={() => void copyCodes()}>
          {t('actions.copyAll')}
        </Button>
      </Modal>
    </AdminPage>
  )
}
