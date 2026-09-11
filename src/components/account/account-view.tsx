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
import { Button, Card, Statistic, Tag, Typography } from 'antd'
import { ArrowRight, Coins, Crown, KeyRound, ShieldCheck, UserRound, WalletCards } from 'lucide-react'
import Link from 'next/link'

import { useAccountUser } from '@/components/account/account-shell'
import { apiFetch } from '@/lib/api-client'

type PointsData = {
  pointsBalance: number
}

export function AccountOverview() {
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
          <Typography.Text className="account-eyebrow">Overview</Typography.Text>
          <Typography.Title level={2}>账户概览</Typography.Title>
          <Typography.Text type="secondary">从这里进入资料、安全和积分功能。</Typography.Text>
        </div>
      </div>

      <div className="account-overview-grid">
        <Card className="account-card account-overview-balance">
          <Statistic title="当前积分" value={pointsBalance} prefix={<Coins size={17} />} />
          <Link href="/account/points"><Button type="link" icon={<ArrowRight size={14} />} iconPosition="end">查看积分记录</Button></Link>
        </Card>

        <Card className="account-card" title="账户状态">
          <div className="account-status-list">
            <div><span>登录密码</span><Tag color={user.passwordConfigured ? 'success' : 'warning'}>{user.passwordConfigured ? '已设置' : '待设置'}</Tag></div>
            <div><span>钱包地址</span><Tag color={user.walletAddress ? 'success' : 'default'}>{user.walletAddress ? '已绑定' : '未绑定'}</Tag></div>
            <div><span>账户身份</span><strong>{user.role === 'ADMIN' ? '管理员' : '个人用户'}</strong></div>
          </div>
        </Card>

        <Card className="account-card account-overview-actions" title="快捷入口">
          <Link href="/account/profile"><UserRound size={16} /><span>编辑个人资料</span><ArrowRight size={15} /></Link>
          <Link href="/account/security"><ShieldCheck size={16} /><span>管理安全与登录</span><ArrowRight size={15} /></Link>
          <Link href="/account/points"><WalletCards size={16} /><span>兑换卡密与查看积分</span><ArrowRight size={15} /></Link>
          <Link href="/account/membership"><Crown size={16} /><span>开通与管理会员权益</span><ArrowRight size={15} /></Link>
        </Card>

        <Card className="account-card account-overview-identity">
          <KeyRound size={17} />
          <div>
            <strong>你的账户由独立路由管理</strong>
            <Typography.Text type="secondary">资料、安全和积分互不干扰，操作结果会立即同步到账户菜单。</Typography.Text>
          </div>
        </Card>
      </div>
    </div>
  )
}
