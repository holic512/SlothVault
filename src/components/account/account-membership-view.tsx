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
import { useLocale, useTranslations } from 'next-intl'

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

export function AccountMembershipView() {
  const t = useTranslations('Account.membership')
  const locale = useLocale()
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
      message.success(t('purchased'))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account-membership'] }),
        queryClient.invalidateQueries({ queryKey: ['account-points'] }),
        queryClient.invalidateQueries({ queryKey: ['session-user'] }),
      ])
    },
    onError: (error) => message.error(error.message),
  })
  const data = membershipQuery.data
  const expiryLabel = (expiresAt: string | null) => expiresAt ? new Date(expiresAt).toLocaleString(locale) : t('permanent')

  const confirmPurchase = (level: MembershipLevel) => {
    modal.confirm({
      title: t('purchaseTitle', { name: level.name }),
      content: level.validityDays ? t('purchaseDuration', { points: level.pricePoints, days: level.validityDays }) : t('purchasePermanent', { points: level.pricePoints }),
      okText: t('confirm'),
      cancelText: t('cancel'),
      onOk: () => purchaseMutation.mutateAsync(level.id),
    })
  }

  return (
    <div className="account-route membership-route">
      <div className="account-route-heading">
        <div>
          <Typography.Text className="account-eyebrow">{t('kicker')}</Typography.Text>
          <Typography.Title level={2}>{t('title')}</Typography.Title>
          <Typography.Text type="secondary">{t('description')}</Typography.Text>
        </div>
      </div>

      <div className="membership-summary-grid">
        <Card className="account-card membership-current-card" loading={membershipQuery.isLoading}>
          <Space direction="vertical" size={10} className="full-width">
            <Typography.Text type="secondary">{t('current')}</Typography.Text>
            {data?.currentMembership ? (
              <>
                <Typography.Title level={3}><Crown size={20} /> {data.currentMembership.name}</Typography.Title>
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label={t('level')}>Lv.{data.currentMembership.rank}</Descriptions.Item>
                  <Descriptions.Item label={t('validity')}>{expiryLabel(data.currentMembership.expiresAt)}</Descriptions.Item>
                </Descriptions>
              </>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('noCurrent')} />
            )}
          </Space>
        </Card>
        <Card className="account-card membership-points-card" title={<span className="account-card-title"><Coins size={16} />{t('availablePoints')}</span>} loading={membershipQuery.isLoading}>
          <Typography.Title level={2}>{data?.pointsBalance ?? 0}</Typography.Title>
          <Typography.Text type="secondary">{t('pointsHint')}</Typography.Text>
        </Card>
      </div>

      <Card className="account-card membership-levels-card" title={t('availableLevels')} loading={membershipQuery.isLoading}>
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
                  <strong className="membership-level-price"><Coins size={17} />{t('price', { points: level.pricePoints })}</strong>
                  <span className="membership-level-duration">
                    {level.validityDays ? <><CalendarClock size={14} />{t('duration', { days: level.validityDays })}</> : <><Infinity size={14} />{t('permanent')}</>}
                  </span>
                  <Button
                    type="primary"
                    icon={permanentCurrent ? <Check size={15} /> : <ShoppingCart size={15} />}
                    disabled={lowerThanCurrent || permanentCurrent || insufficient}
                    loading={purchaseMutation.isPending && purchaseMutation.variables === level.id}
                    onClick={() => confirmPurchase(level)}
                  >
                    {permanentCurrent ? t('owned') : lowerThanCurrent ? t('higherLevel') : insufficient ? t('insufficient') : t('purchase')}
                  </Button>
                </section>
              )
            })}
          </div>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('noLevels')} />}
      </Card>

      <Card className="account-card membership-history-card" title={<span className="account-card-title"><LockKeyhole size={16} />{t('history')}</span>}>
        <Table<MembershipGrant>
          rowKey="id"
          size="small"
          loading={membershipQuery.isLoading}
          dataSource={data?.grants || []}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          scroll={{ x: 720 }}
          columns={[
            { title: t('table.level'), dataIndex: ['membershipLevel', 'name'], render: (_value, item) => <Space><Tag color="gold">Lv.{item.membershipLevel.rank}</Tag>{item.membershipLevel.name}</Space> },
            { title: t('table.source'), dataIndex: 'source', render: (value) => value === 'POINT_PURCHASE' ? t('table.purchase') : t('table.granted') },
            { title: t('table.grantedAt'), dataIndex: 'grantedAt', render: (value) => new Date(value).toLocaleString(locale) },
            { title: t('table.expiresAt'), dataIndex: 'expiresAt', render: (value) => expiryLabel(value) },
            { title: t('table.status'), dataIndex: 'active', render: (_value, item) => item.revokedAt ? <Tag>{t('table.revoked')}</Tag> : item.active ? <Tag color="success">{t('table.active')}</Tag> : <Tag color="warning">{t('table.expired')}</Tag> },
          ]}
        />
      </Card>
    </div>
  )
}
