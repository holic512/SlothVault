'use client'

/**
 * @file account-points-view.tsx
 * @project SlothVault
 * @module Account Points Center
 * @description Provides the authenticated core balance and ledger without optional card redemption UI.
 * @logic Read host balances and ledger while rendering authorized account.points plugin entry contributions.
 * @dependencies React Query, Ant Design, account shell, account points API
 * @index_tags account,points,gift-card,ledger
 * @author holic512
 */
import { useQuery } from '@tanstack/react-query'
import { Statistic, Table } from 'antd'
import { Coins } from 'lucide-react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'

import { useAccountUser } from '@/components/account/account-shell'
import styles from '@/styles/modules/account-points.module.css'
import { AccountCard } from '@/components/account/account-card'
import { AccountQueryError } from '@/components/account/account-query-error'
import { PluginSlot } from '@/components/plugins/plugin-ui'
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
  const pointsQuery = useQuery({
    queryKey: ['account-points', 'ledger'],
    queryFn: () => apiFetch<PointsData>('/api/account/points?pageSize=50'),
  })
  const pointsBalance = pointsQuery.data?.pointsBalance ?? user.pointsBalance

  return (
    <div className="account-route">
      {pointsQuery.isError ? (
        <AccountQueryError retry={() => void pointsQuery.refetch()} />
      ) : (
        <>
          <div className="account-points-summary">
            <AccountCard className="account-overview-balance">
              <Statistic title={t('current')} value={pointsBalance} prefix={<Coins size={17} />} />
              <div className={styles.actions}>
                <PluginSlot name="account.points" surface="account" />
                <Link className="account-text-link" href="/account/membership">{t('usePoints')}</Link>
              </div>
            </AccountCard>
          </div>

          <AccountCard className="account-ledger-card" title={t('history')}>
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
          </AccountCard>
        </>
      )}
    </div>
  )
}
