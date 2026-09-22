'use client'

/**
 * @file account-view.tsx
 * @project SlothVault
 * @module Personal Account Overview
 * @description Renders the concise account overview for the authenticated workspace.
 * @logic Read the authoritative point balance, surface the most relevant account states, and link each action to its dedicated account route.
 * @dependencies React Query, Ant Design, account shell, account points API
 * @index_tags account,overview,points,workspace
 * @author holic512
 */
import { useQuery } from '@tanstack/react-query'
import { Statistic, Tag, Typography } from 'antd'
import { ArrowRight, Coins, Crown, FileSignature, KeyRound, ShieldCheck, UserRound, WalletCards } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { useAccountUser } from '@/components/account/account-shell'
import { AccountCard } from '@/components/account/account-card'
import { apiFetch } from '@/lib/api-client'

type PointsData = {
  pointsBalance: number
}

export function AccountOverview() {
  const t = useTranslations('Account.overview')
  const user = useAccountUser()
  const pointsQuery = useQuery({
    queryKey: ['account-points', 'summary'],
    queryFn: () => apiFetch<PointsData>('/api/account/points?pageSize=1'),
  })
  const pointsBalance = pointsQuery.data?.pointsBalance ?? user.pointsBalance

  return (
    <div className="account-route">
      <div className="account-route-heading">
        <div>
          <Typography.Title level={1}>{t('title')}</Typography.Title>
          <Typography.Text type="secondary">{t('description')}</Typography.Text>
        </div>
      </div>

      <div className="account-overview-grid">
        <AccountCard className="account-overview-balance">
          <Statistic title={t('points')} value={pointsBalance} prefix={<Coins size={17} />} />
          <Link className="account-text-link" href="/account/points">{t('viewPoints')}<ArrowRight size={15} /></Link>
        </AccountCard>

        <AccountCard title={t('status.title')}>
          <div className="account-status-list">
            <div><span>{t('status.password')}</span><Tag color={user.passwordConfigured ? 'success' : 'warning'}>{user.passwordConfigured ? t('status.configured') : t('status.notConfigured')}</Tag></div>
            <div><span>{t('status.wallet')}</span><Tag color={user.walletAddress ? 'success' : 'default'}>{user.walletAddress ? t('status.bound') : t('status.notBound')}</Tag></div>
            <div><span>{t('status.role')}</span><strong>{user.role === 'ADMIN' ? t('status.administrator') : t('status.user')}</strong></div>
          </div>
        </AccountCard>

        <AccountCard className="account-overview-actions" title={t('quickLinks')}>
          <Link href="/account/profile"><UserRound size={16} /><span>{t('actions.profile')}</span><ArrowRight size={15} /></Link>
          <Link href="/account/security"><ShieldCheck size={16} /><span>{t('actions.security')}</span><ArrowRight size={15} /></Link>
          <Link href="/account/points"><WalletCards size={16} /><span>{t('actions.points')}</span><ArrowRight size={15} /></Link>
          <Link href="/account/membership"><Crown size={16} /><span>{t('actions.membership')}</span><ArrowRight size={15} /></Link>
          <Link href="/account/contracts"><FileSignature size={16} /><span>{t('actions.contracts')}</span><ArrowRight size={15} /></Link>
        </AccountCard>

        <div className="account-overview-identity">
          <KeyRound size={17} />
          <div>
            <strong>{t('identity.title')}</strong>
            <Typography.Text type="secondary">{t('identity.description')}</Typography.Text>
          </div>
        </div>
      </div>
    </div>
  )
}
