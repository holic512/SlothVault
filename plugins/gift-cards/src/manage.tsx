
/**
 * @file manage.tsx
 * @project SlothVault
 * @module Gift Card Administration
 * @description Issues point-card batches, shows aggregate redemption progress, and allows administrators to inspect and copy plaintext codes repeatedly.
 * @logic Issue bounded batches, show stable paginated batch summaries, and inspect per-card status in a drawer.
 * @dependencies Ant Design, React Query, gift-card admin API
 * @index_tags admin,gift-card,issuance,points,codes
 * @author holic512
 */
import { useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@slothvault/plugin-sdk/client'
import { Alert, App, Button, Drawer, Form, Input, InputNumber, Modal, Progress, Select, Space, Table, Typography } from '@slothvault/plugin-sdk/client'

import { useLocale, useTranslations } from '@slothvault/plugin-sdk/client'

import { PluginPage as AdminPage, PluginPageActions as AdminPageActions, PluginTablePanel as AdminTablePanel } from '@slothvault/plugin-sdk/client'
import { formatAdminDate, formatAdminError, formatAdminNumber } from '@slothvault/plugin-sdk/client'
import { api } from '@slothvault/plugin-sdk/client'

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

type CardRow = { id: string; code: string; points: number; status: string; redeemedBy: string | null; redeemedAt: string | null; expiresAt: string | null }

type IssueResult = {
  batch: BatchRow
  codes: string[]
}

export default function GiftCardsManager() {
  const t = useTranslations('Plugins.giftCards.manage')
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [selectedBatch, setSelectedBatch] = useState<BatchRow | null>(null)
  const [cardPage, setCardPage] = useState(1)
  const [status, setStatus] = useState<string | undefined>()
  const details = useQuery({
    queryKey: ['plugin', 'slothvault.gift-cards', 'cards', selectedBatch?.id, cardPage, status],
    enabled: !!selectedBatch,
    queryFn: () => api<{ list: CardRow[]; total: number }>('slothvault.gift-cards', `cards?batchId=${selectedBatch!.id}&page=${cardPage}&pageSize=20${status ? '&status=' + status : ''}`),
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [createOpen, setCreateOpen] = useState(false)
  const [issuedCodes, setIssuedCodes] = useState<string[]>([])
  const [form] = Form.useForm<{ name: string; points: number; quantity: number; expiresAt?: string }>()
  const query = useQuery({
    queryKey: ['admin-gift-cards', page, pageSize],
    queryFn: () => api<{ list: BatchRow[]; total: number }>('slothvault.gift-cards',
      `batches?page=${page}&pageSize=${pageSize}`,
    ),
  })
  const mutation = useMutation({
    mutationFn: (values: ReturnType<typeof form.getFieldsValue>) =>
      api<IssueResult>('slothvault.gift-cards', 'batches', {
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

  const copyCodes = async (codes = issuedCodes) => {
    try { await navigator.clipboard.writeText(codes.join('\n')); message.success(t('messages.codesCopied')) }
    catch { message.error(t('messages.copyFailed')) }
  }

  return (
    <AdminPage>
      <AdminPageActions>
        <Space>
          <Button onClick={() => void query.refetch()}>{t('actions.refresh')}</Button>
          <Button type="primary" onClick={() => setCreateOpen(true)}>{t('actions.create')}</Button>
        </Space>
      </AdminPageActions>

      {query.isError && <Alert type="error" title={query.error.message} action={<Button onClick={() => void query.refetch()}>{t('actions.refresh')}</Button>} />}
      <AdminTablePanel>
        <Table<BatchRow>
          rowKey="id"
          loading={query.isLoading}
          dataSource={query.data?.list || []}
          scroll={{ x: 760 }}
          pagination={{
            current: page,
            pageSize,
            total: query.data?.total || 0,
            showSizeChanger: true,
            onChange: (nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize) },
          }}
          columns={[
            { title: t('table.batch'), dataIndex: 'name', minWidth: 180, render: (name, row) => <Button type="link" onClick={() => { setSelectedBatch(row); setCardPage(1); setStatus(undefined) }}>{name}</Button> },
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

      <Drawer title={selectedBatch?.name} open={!!selectedBatch} onClose={() => setSelectedBatch(null)} width={900} destroyOnHidden>
        <Space orientation="vertical" style={{ width: '100%' }}>
          <Alert type="warning" showIcon title={t('plaintextNotice')} />
          <Space wrap>
            <Select value={status} allowClear placeholder={t('allStatuses')} style={{ minWidth: 150 }} onChange={value => { setStatus(value); setCardPage(1) }} options={['unused', 'used', 'expired', 'disabled'].map(value => ({ value, label: t(`statuses.${value}`) }))} />
            <Button disabled={!details.data?.list.length} onClick={() => void copyCodes(details.data!.list.map(row => row.code))}>{t('copyPage')}</Button>
          </Space>
          {details.isError && <Alert type="error" title={details.error.message} action={<Button onClick={() => void details.refetch()}>{t('actions.refresh')}</Button>} />}
          <Table<CardRow> rowKey="id" size="small" loading={details.isPending} dataSource={details.data?.list ?? []} scroll={{ x: 840 }} pagination={{ current: cardPage, pageSize: 20, total: details.data?.total ?? 0, showSizeChanger: false, onChange: setCardPage }} columns={[
            { title: t('code'), dataIndex: 'code', width: 260, render: value => <Space><Typography.Text code>{value}</Typography.Text><Button size="small" onClick={() => void copyCodes([value])}>{t('copy')}</Button></Space> },
            { title: t('table.points'), dataIndex: 'points', width: 80 },
            { title: t('status'), dataIndex: 'status', width: 90, render: value => t(`statuses.${value}`) },
            { title: t('redeemedBy'), dataIndex: 'redeemedBy', render: value => value ?? '—' },
            { title: t('redeemedAt'), dataIndex: 'redeemedAt', width: 170, render: value => formatAdminDate(locale, value) },
            { title: t('table.expiresAt'), dataIndex: 'expiresAt', width: 170, render: value => value ? formatAdminDate(locale, value) : t('permanent') },
          ]} />
        </Space>
      </Drawer>

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
        <Button className="gift-card-copy" block onClick={() => void copyCodes()}>
          {t('actions.copyAll')}
        </Button>
      </Modal>
    </AdminPage>
  )
}
