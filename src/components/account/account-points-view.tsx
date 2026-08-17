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
      message.success(`已兑换 ${result.pointsAdded} 积分`)
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
          <Typography.Text className="account-eyebrow">Points</Typography.Text>
          <Typography.Title level={2}>积分中心</Typography.Title>
          <Typography.Text type="secondary">兑换卡密并查看每一笔积分变动。</Typography.Text>
        </div>
      </div>

      <div className="account-points-summary">
        <Card className="account-card account-overview-balance">
          <Statistic title="当前积分" value={pointsBalance} prefix={<Coins size={17} />} />
        </Card>
        <Card className="account-card account-route-card" title={<span className="account-card-title"><Ticket size={16} />兑换卡密</span>}>
          <Form form={redeemForm} layout="vertical" onFinish={(values) => redeemMutation.mutate(values)}>
            <Form.Item name="code" rules={[{ required: true, message: '请输入卡密' }]}>
              <Input placeholder="SV-XXXXX-XXXXX-XXXXX-XXXXX" />
            </Form.Item>
            <Button htmlType="submit" loading={redeemMutation.isPending}>兑换积分</Button>
          </Form>
        </Card>
      </div>

      <Card className="account-card account-ledger-card" title="积分记录">
        <Table<PointEntry>
          rowKey="id"
          size="small"
          loading={pointsQuery.isLoading}
          dataSource={pointsQuery.data?.list || []}
          pagination={false}
          scroll={{ x: 660 }}
          columns={[
            { title: '时间', dataIndex: 'createdAt', width: 176, render: (value) => new Date(value).toLocaleString() },
            { title: '说明', dataIndex: 'description', render: (value) => value || '积分变动' },
            { title: '变动', dataIndex: 'amount', width: 100, align: 'right', render: (value) => <strong>{value > 0 ? `+${value}` : value}</strong> },
            { title: '余额', dataIndex: 'balanceAfter', width: 100, align: 'right' },
          ]}
        />
      </Card>
    </div>
  )
}
