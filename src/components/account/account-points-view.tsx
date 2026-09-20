'use client'

/**
 * @file account-points-view.tsx
 * @project SlothVault
 * @module Account Points Center
 * @description Provides the authenticated point balance, gift-card redemption, and immutable point ledger.
 * @logic Read balance and ledger together, redeem a gift card through the protected API, then refresh both account balance sources.
 * @dependencies React Query, Ant Design, account shell, account points and redeem APIs
 * @index_tags account,points,gift-card,ledger
 * @author holic512
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Form, Input, Statistic, Table, Typography } from 'antd'
import { Coins, Ticket } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { useAccountUser } from '@/components/account/account-shell'
import { apiFetch } from '@/lib/api-client'

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

export function AccountPointsView() {
  const t = useTranslations('Account.points')
  const locale = useLocale()
  const user = useAccountUser()
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [redeemForm] = Form.useForm<{ code: string }>()
  const pointsQuery = useQuery({
    queryKey: ['account-points', 'ledger'],
    queryFn: () => apiFetch<PointsData>('/api/account/points?pageSize=50'),
  })
  const redeemMutation = useMutation({
    mutationFn: (values: { code: string }) =>
      apiFetch<{ pointsAdded: number }>('/api/account/redeem', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: async (result) => {
      message.success(t('redeemed', { points: result.pointsAdded }))
      redeemForm.resetFields()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account-points'] }),
        queryClient.invalidateQueries({ queryKey: ['session-user'] }),
      ])
    },
    onError: (error) => message.error(error.message),
  })
  const pointsBalance = pointsQuery.data?.pointsBalance ?? user.pointsBalance

  return (
    <div className="account-route">
      <div className="account-route-heading">
        <div>
          <Typography.Text className="account-eyebrow">{t('kicker')}</Typography.Text>
          <Typography.Title level={2}>{t('title')}</Typography.Title>
          <Typography.Text type="secondary">{t('description')}</Typography.Text>
        </div>
      </div>

      <div className="account-points-summary">
        <Card className="account-card account-overview-balance">
          <Statistic title={t('current')} value={pointsBalance} prefix={<Coins size={17} />} />
        </Card>
        <Card className="account-card account-route-card" title={<span className="account-card-title"><Ticket size={16} />{t('redeemTitle')}</span>}>
          <Form form={redeemForm} layout="vertical" onFinish={(values) => redeemMutation.mutate(values)}>
            <Form.Item name="code" rules={[{ required: true, message: t('codeRequired') }]}>
              <Input placeholder="SV-XXXXX-XXXXX-XXXXX-XXXXX" />
            </Form.Item>
            <Button htmlType="submit" loading={redeemMutation.isPending}>{t('redeem')}</Button>
          </Form>
        </Card>
      </div>

      <Card className="account-card account-ledger-card" title={t('history')}>
        <Table<PointEntry>
          rowKey="id"
          size="small"
          loading={pointsQuery.isLoading}
          dataSource={pointsQuery.data?.list || []}
          pagination={false}
          scroll={{ x: 660 }}
          columns={[
            { title: t('table.time'), dataIndex: 'createdAt', width: 176, render: (value) => new Date(value).toLocaleString(locale) },
            { title: t('table.description'), dataIndex: 'description', render: (value) => value || t('table.defaultDescription') },
            { title: t('table.change'), dataIndex: 'amount', width: 100, align: 'right', render: (value) => <strong>{value > 0 ? `+${value}` : value}</strong> },
            { title: t('table.balance'), dataIndex: 'balanceAfter', width: 100, align: 'right' },
          ]}
        />
      </Card>
    </div>
  )
}
