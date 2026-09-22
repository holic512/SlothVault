'use client'

import type { ReactNode } from 'react'

import { Skeleton } from 'antd'

import { usePublicNavStyle } from '@/components/providers/public-nav-style-context'
import { LiquidGlassCard } from '@/components/ui/liquid-glass-card'

/** Keep a stable wrapper so changing appearance never remounts account forms. */
export function AccountCard({
  children, title, extra, className = '', loading = false,
}: {
  children: ReactNode
  title?: ReactNode
  extra?: ReactNode
  className?: string
  loading?: boolean
}) {
  const { publicNavStyle } = usePublicNavStyle()
  return (
    <LiquidGlassCard
      enabled={publicNavStyle === 'liquid-glass'}
      className={`account-card ${className}`}
      contentClassName="account-card-content"
      padding={0}
      outerRadius={20}
      refraction={8}
      aria-busy={loading}
    >
      {(title || extra) && <div className="account-card-heading"><h2>{title}</h2>{extra}</div>}
      <div className="account-card-body">
        {loading ? <Skeleton active={false} title={false} paragraph={{ rows: 2 }} /> : children}
      </div>
    </LiquidGlassCard>
  )
}
