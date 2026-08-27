'use client'

/**
 * @file account-membership-view.tsx
 * @project SlothVault
 * @module Account Membership Center
 * @description Shows the current entitlement, point-priced levels, and immutable membership grant history for the signed-in user.
 * @logic Read authoritative membership and point data, let users purchase only through the protected API, and refresh account balances after a successful grant.
 * @dependencies React Query, Ant Design, account shell, account membership API
 * @index_tags account,membership,points,purchase,history
 * @author holic512
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Descriptions, Empty, Space, Table, Tag, Typography } from 'antd'
import { CalendarClock, Check, Coins, Crown, Infinity, LockKeyhole, ShoppingCart } from 'lucide-react'

import { apiFetch } from '@/lib/api-client'

type MembershipLevel = {
  id: string
  name: string
  rank: number
  pricePoints: number
  validityDays: number | null
  status: number
}

type MembershipGrant = {
  id: string
  membershipLevel: MembershipLevel
  source: string
  pointsCost: number | null
  grantedAt: string
  expiresAt: string | null
  revokedAt: string | null
  active: boolean
}

type MembershipData = {
  pointsBalance: number
  currentMembership: {
    id: string
    name: string
    rank: number
    expiresAt: string | null
    source: string
  } | null
  levels: MembershipLevel[]
  grants: MembershipGrant[]
}

function expiryLabel(expiresAt: string | null) {
  return expiresAt ? new Date(expiresAt).toLocaleString() : '永久有效'
}

export function AccountMembershipView() {
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const membershipQuery = useQuery({
    queryKey: ['account-membership'],
    queryFn: () => apiFetch<MembershipData>('/api/account/membership'),
  })
  const purchaseMutation = useMutation({
    mutationFn: (membershipLevelId: string) => apiFetch<{ pointsBalance: number; membership: MembershipData['currentMembership'] }>(
      '/api/account/membership',
      { method: 'POST', body: JSON.stringify({ membershipLevelId: Number(membershipLevelId) }) },
    ),
    onSuccess: async () => {
      message.success('会员权益已开通')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account-membership'] }),
        queryClient.invalidateQueries({ queryKey: ['account-points'] }),
        queryClient.invalidateQueries({ queryKey: ['session-user'] }),
      ])
    },
    onError: (error) => message.error(error.message),
  })
  const data = membershipQuery.data

  const confirmPurchase = (level: MembershipLevel) => {
    modal.confirm({
      title: `开通 ${level.name}`,
      content: `将扣除 ${level.pricePoints} 积分${level.validityDays ? `，有效期 ${level.validityDays} 天` : '，永久有效'}。`,
      okText: '确认开通',
      cancelText: '取消',
      onOk: () => purchaseMutation.mutateAsync(level.id),
    })
  }

  return (
    <div className="account-route membership-route">
      <div className="account-route-heading">
        <div>
          <Typography.Text className="account-eyebrow">Membership</Typography.Text>
          <Typography.Title level={2}>会员中心</Typography.Title>
          <Typography.Text type="secondary">使用积分开通等级，解锁对应文章阅读权限。</Typography.Text>
        </div>
      </div>

      <div className="membership-summary-grid">
        <Card className="account-card membership-current-card" loading={membershipQuery.isLoading}>
          <Space direction="vertical" size={10} className="full-width">
            <Typography.Text type="secondary">当前会员权益</Typography.Text>
            {data?.currentMembership ? (
              <>
                <Typography.Title level={3}><Crown size={20} /> {data.currentMembership.name}</Typography.Title>
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="等级">Lv.{data.currentMembership.rank}</Descriptions.Item>
                  <Descriptions.Item label="有效期">{expiryLabel(data.currentMembership.expiresAt)}</Descriptions.Item>
                </Descriptions>
              </>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有有效会员权益" />
            )}
          </Space>
        </Card>
        <Card className="account-card membership-points-card" title={<span className="account-card-title"><Coins size={16} />可用积分</span>} loading={membershipQuery.isLoading}>
          <Typography.Title level={2}>{data?.pointsBalance ?? 0}</Typography.Title>
          <Typography.Text type="secondary">积分会在购买成功后即时扣除。</Typography.Text>
        </Card>
      </div>

      <Card className="account-card membership-levels-card" title="可开通等级" loading={membershipQuery.isLoading}>
        {data?.levels.length ? (
          <div className="membership-level-grid">
            {data.levels.map((level) => {
              const lowerThanCurrent = Boolean(data.currentMembership && level.rank < data.currentMembership.rank)
              const permanentCurrent = data.currentMembership?.id === level.id && data.currentMembership.expiresAt === null
              const insufficient = (data.pointsBalance ?? 0) < level.pricePoints
              return (
                <section key={level.id} className="membership-level-card">
                  <div className="membership-level-card-heading">
                    <span className="membership-level-rank">Lv.{level.rank}</span>
                    <Tag color="gold"><Crown size={13} />{level.name}</Tag>
                  </div>
                  <strong className="membership-level-price"><Coins size={17} />{level.pricePoints} 积分</strong>
                  <span className="membership-level-duration">
                    {level.validityDays ? <><CalendarClock size={14} />有效 {level.validityDays} 天</> : <><Infinity size={14} />永久有效</>}
                  </span>
                  <Button
                    type="primary"
                    icon={permanentCurrent ? <Check size={15} /> : <ShoppingCart size={15} />}
                    disabled={lowerThanCurrent || permanentCurrent || insufficient}
                    loading={purchaseMutation.isPending && purchaseMutation.variables === level.id}
                    onClick={() => confirmPurchase(level)}
                  >
                    {permanentCurrent ? '已永久拥有' : lowerThanCurrent ? '当前等级更高' : insufficient ? '积分不足' : '积分开通'}
                  </Button>
                </section>
              )
            })}
          </div>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="管理员尚未配置可购买会员等级" />}
      </Card>

      <Card className="account-card membership-history-card" title={<span className="account-card-title"><LockKeyhole size={16} />会员授权记录</span>}>
        <Table<MembershipGrant>
          rowKey="id"
          size="small"
          loading={membershipQuery.isLoading}
          dataSource={data?.grants || []}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          scroll={{ x: 720 }}
          columns={[
            { title: '等级', dataIndex: ['membershipLevel', 'name'], render: (_value, item) => <Space><Tag color="gold">Lv.{item.membershipLevel.rank}</Tag>{item.membershipLevel.name}</Space> },
            { title: '来源', dataIndex: 'source', render: (value) => value === 'POINT_PURCHASE' ? '积分购买' : '管理员授予' },
            { title: '授予时间', dataIndex: 'grantedAt', render: (value) => new Date(value).toLocaleString() },
            { title: '到期时间', dataIndex: 'expiresAt', render: (value) => expiryLabel(value) },
            { title: '状态', dataIndex: 'active', render: (_value, item) => item.revokedAt ? <Tag>已取消</Tag> : item.active ? <Tag color="success">有效</Tag> : <Tag color="warning">已过期</Tag> },
          ]}
        />
      </Card>
    </div>
  )
}
