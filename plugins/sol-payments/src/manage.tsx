/**
 * @file manage.tsx
 * @project SlothVault
 * @module SOL Payment Administration
 * @description Presents localized order filters, immutable quotes and payment verification in the shared admin layout.
 * @logic Filter and paginate orders, inspect full chain evidence, and link directly to this plugin's configuration without manual success overrides.
 * @dependencies Plugin client SDK, React, shared payment UI and plugin-owned messages
 * @index_tags plugins,payments,admin,orders,i18n
 * @author holic512
 */
import { useState } from 'react'
import {
  Alert, Button, Form, Input, InputNumber, Select, Space, Table, Drawer,
  api, useQuery, useMutation, useQueryClient, useRouter, useLocale,
  PluginPage, PluginPageActions, PluginTablePanel, PluginToolbar, PluginI18nProvider,
} from '@slothvault/plugin-sdk/client'
import { ID, useCopy, useStatus, PaymentError, OrderDetails, type Order } from './ui'
import { messages } from './messages'

type Filters = { userId?: number; orderId?: string; signature?: string; status?: string }

export default function Manage() {
  return <PluginI18nProvider messages={messages}><ManageContent /></PluginI18nProvider>
}

function ManageContent() {
  const c = useCopy(), status = useStatus(), router = useRouter(), client = useQueryClient(), locale = useLocale()
  const [form] = Form.useForm<Filters>()
  const [filters, setFilters] = useState(''), [page, setPage] = useState(1), [selected, setSelected] = useState<Order | null>(null)
  const query = useQuery({
    queryKey: [ID, 'admin', filters, page],
    queryFn: () => api<{ list: Order[]; total: number }>(ID, `admin/orders?page=${page}&${filters}`),
  })
  const check = useMutation({
    mutationFn: (orderId: string) => api<Order>(ID, 'admin/reconcile', { method: 'POST', body: JSON.stringify({ orderId }) }),
    onSuccess: async result => { setSelected(result); await client.invalidateQueries({ queryKey: [ID, 'admin'] }) },
  })
  const filterOrders = (values: Filters) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(values)) if (value) params.set(key, String(value).trim())
    setFilters(params.toString())
    setPage(1)
  }

  return <PluginPage className="sol-orders-page">
    <PluginPageActions><Space wrap>
      <Button onClick={() => router.push(`/admin/mm/plugins?plugin=${ID}&tab=config`)}>{c.configure}</Button>
      <Button loading={query.isFetching} onClick={() => void query.refetch()}>{c.refresh}</Button>
    </Space></PluginPageActions>
    <Alert type="info" showIcon title={c.adminIntro} />
    <PluginToolbar>
      <Form form={form} className="sol-order-filters" layout="vertical" onFinish={filterOrders}>
        <Form.Item name="userId" label={c.user}><InputNumber min={1} precision={0} /></Form.Item>
        <Form.Item name="orderId" label={c.id}><Input allowClear /></Form.Item>
        <Form.Item name="signature" label={c.signature}><Input allowClear /></Form.Item>
        <Form.Item name="status" label={c.status}>
          <Select allowClear placeholder={c.all} options={['AWAITING_PAYMENT', 'CONFIRMING', 'PAID', 'EXPIRED', 'FAILED', 'NEEDS_REVIEW'].map(value => ({ value, label: status(value) }))} />
        </Form.Item>
        <Space className="sol-filter-actions" wrap>
          <Button type="primary" htmlType="submit">{c.filter}</Button>
          <Button onClick={() => { form.resetFields(); setFilters(''); setPage(1) }}>{c.reset}</Button>
        </Space>
      </Form>
    </PluginToolbar>
    {query.isError ? <PaymentError error={query.error} /> : null}
    {check.isError ? <PaymentError error={check.error} /> : null}
    <PluginTablePanel>
      <Table<Order>
        rowKey="id" size="small" loading={query.isPending} dataSource={query.data?.list ?? []}
        scroll={query.data?.list.length ? { x: 820 } : undefined}
        locale={{ emptyText: filters ? c.noResults : c.noData }}
        pagination={{ current: page, pageSize: 20, total: query.data?.total ?? 0, onChange: setPage, hideOnSinglePage: true }}
        columns={[
          { title: c.id, dataIndex: 'id', width: 200, ellipsis: true, render: (value, row) => <Button className="sol-order-id" type="link" title={value} onClick={() => setSelected(row)}>{value}</Button> },
          { title: c.user, dataIndex: 'userId', width: 90, render: value => value ?? '—' },
          { title: c.received, dataIndex: 'points', width: 110, render: value => Number(value).toLocaleString(locale) },
          { title: c.status, dataIndex: 'status', width: 145, render: status },
          { title: c.created, dataIndex: 'createdAt', width: 180, render: value => new Date(value).toLocaleString(locale) },
          { title: c.details, key: 'view', width: 95, render: (_, row) => <Button type="link" onClick={() => setSelected(row)}>{c.inspect}</Button> },
        ]}
      />
    </PluginTablePanel>
    <Drawer open={!!selected} onClose={() => setSelected(null)} title={c.details}>
      {selected ? <Space orientation="vertical" size="middle" className="sol-order-detail">
        <OrderDetails order={selected} />
        {['CONFIRMING', 'NEEDS_REVIEW'].includes(selected.status) ? <Button loading={check.isPending} onClick={() => check.mutate(selected.id)}>{c.check}</Button> : null}
      </Space> : null}
    </Drawer>
  </PluginPage>
}
