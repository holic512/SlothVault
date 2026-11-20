'use client'

import type { ReactNode } from 'react'

import { Skeleton } from 'antd'

export function AccountCard({
  children, title, extra, className = '', loading = false,
}: {
  children: ReactNode
  title?: ReactNode
  extra?: ReactNode
  className?: string
  loading?: boolean
}) {
  return (
    <div className={`account-card ${className}`} aria-busy={loading}>
      <div className="account-card-content">
        {(title || extra) && <div className="account-card-heading"><h2>{title}</h2>{extra}</div>}
        <div className="account-card-body">
          {loading ? <Skeleton active={false} title={false} paragraph={{ rows: 2 }} /> : children}
        </div>
      </div>
    </div>
  )
}
