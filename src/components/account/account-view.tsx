'use client'

/**
 * @file account-view.tsx
 * @project SlothVault
 * @module Personal Account Overview
 * @description Renders a compact personal dashboard with point totals, recent ledger charts, account state, and quick actions.
 * @logic Read the authoritative balance and latest ledger entries, summarize only the returned transactions, and lazily render accessible charts beside account navigation.
 * @dependencies React Query, Ant Design, ECharts dashboard chart, account shell, account points API
 * @index_tags account,overview,dashboard,points,workspace,echarts
 * @author holic512
 */
import { useMemo } from 'react'

import { useQuery } from '@tanstack/react-query'
import { Empty, Skeleton, Statistic, Typography } from 'antd'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Coins, Crown, FileSignature, ShieldCheck, UserRound, WalletCards } from 'lucide-react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'

import { useAccountUser } from '@/components/account/account-shell'
import { AccountCard } from '@/components/account/account-card'
import { AccountQueryError } from '@/components/account/account-query-error'
import { ACCOUNT_DASHBOARD_PAGE_SIZE, summarizeAccountPoints, type AccountPointRecord } from '@/lib/account-dashboard'
import { apiFetch } from '@/lib/api-client'

const AccountPointsChart = dynamic(() => import('@/components/account/account-points-chart'), {
  ssr: false,
  loading: () => <div className="account-dashboard-chart"><Skeleton active={false} title={false} paragraph={{ rows: 4 }} /></div>,
})

type PointsData = {
  pointsBalance: number
  list: AccountPointRecord[]
}

export function AccountOverview() {
  const t = useTranslations('Account.overview')
  const locale = useLocale()
  const user = useAccountUser()
  const pointsQuery = useQuery({
    queryKey: ['account-points', 'dashboard'],
    queryFn: () => apiFetch<PointsData>(`/api/account/points?pageSize=${ACCOUNT_DASHBOARD_PAGE_SIZE}`),
  })
  const pointsBalance = pointsQuery.data?.pointsBalance ?? user.pointsBalance
  const records = pointsQuery.data?.list
  const summary = useMemo(() => summarizeAccountPoints(records || []), [records])
  const rangeLabel = t('dashboard.recentRecords', { count: records?.length ?? 0 })

  return (
    <div className="account-route account-dashboard">
      <div className="account-dashboard-stats">
        <AccountCard className="account-dashboard-stat">
          <Statistic title={t('points')} value={pointsBalance} prefix={<Coins size={17} />} />
          <Link className="account-text-link" href="/account/points">{t('viewPoints')}<ArrowRight size={15} /></Link>
        </AccountCard>
        <AccountCard className="account-dashboard-stat" loading={pointsQuery.isLoading}>
          <Statistic title={t('dashboard.income')} value={pointsQuery.isError ? '—' : summary.income} prefix={<ArrowDownLeft size={17} />} />
        </AccountCard>
        <AccountCard className="account-dashboard-stat" loading={pointsQuery.isLoading}>
          <Statistic title={t('dashboard.spending')} value={pointsQuery.isError ? '—' : summary.spending} prefix={<ArrowUpRight size={17} />} />
        </AccountCard>
      </div>

      {pointsQuery.isError ? <AccountQueryError retry={() => void pointsQuery.refetch()} /> : (
        <div className="account-dashboard-charts">
          <AccountCard className="account-dashboard-chart-card" title={t('dashboard.balanceTrend')} extra={<Typography.Text type="secondary">{pointsQuery.isLoading ? '…' : rangeLabel}</Typography.Text>}>
            {pointsQuery.isLoading ? <div className="account-dashboard-chart"><Skeleton active={false} title={false} paragraph={{ rows: 4 }} /></div> : summary.balances.length ? (
              <AccountPointsChart
                kind="balance"
                summary={summary}
                locale={locale}
                ariaLabel={t('dashboard.balanceAccessible', { count: summary.balances.length, balance: summary.balances.at(-1)![1] })}
                balanceLabel={t('points')}
                incomeLabel={t('dashboard.income')}
                spendingLabel={t('dashboard.spending')}
              />
            ) : <div className="account-dashboard-chart account-dashboard-chart-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('dashboard.noHistory')} /></div>}
          </AccountCard>
          <AccountCard className="account-dashboard-chart-card" title={t('dashboard.pointFlow')}>
            {pointsQuery.isLoading ? <div className="account-dashboard-chart"><Skeleton active={false} title={false} paragraph={{ rows: 4 }} /></div> : summary.income + summary.spending > 0 ? (
              <AccountPointsChart
                kind="flow"
                summary={summary}
                locale={locale}
                ariaLabel={t('dashboard.flowAccessible', { income: summary.income, spending: summary.spending })}
                balanceLabel={t('points')}
                incomeLabel={t('dashboard.income')}
                spendingLabel={t('dashboard.spending')}
              />
            ) : <div className="account-dashboard-chart account-dashboard-chart-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('dashboard.noHistory')} /></div>}
          </AccountCard>
        </div>
      )}

      <div className="account-dashboard-footer">
        <AccountCard className="account-overview-actions" title={t('quickLinks')}>
          <Link href="/account/profile"><UserRound size={16} /><span>{t('actions.profile')}</span><ArrowRight size={15} /></Link>
          <Link href="/account/security"><ShieldCheck size={16} /><span>{t('actions.security')}</span><ArrowRight size={15} /></Link>
          <Link href="/account/points"><WalletCards size={16} /><span>{t('actions.points')}</span><ArrowRight size={15} /></Link>
          <Link href="/account/membership"><Crown size={16} /><span>{t('actions.membership')}</span><ArrowRight size={15} /></Link>
          <Link href="/account/commissions"><FileSignature size={16} /><span>{t('actions.commissions')}</span><ArrowRight size={15} /></Link>
        </AccountCard>
        <AccountCard title={t('status.title')}>
          <div className="account-status-list">
            <div><span>{t('status.password')}</span><span className="account-status-value" data-attention={user.passwordConfigured ? undefined : 'true'}>{user.passwordConfigured ? t('status.configured') : t('status.notConfigured')}</span></div>
            <div><span>{t('status.wallet')}</span><span className="account-status-value">{user.walletAddress ? t('status.bound') : t('status.notBound')}</span></div>
          </div>
        </AccountCard>
      </div>

    </div>
  )
}
