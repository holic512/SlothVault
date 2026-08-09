/**
 * @file admin-page.tsx
 * @project SlothVault
 * @module Administrator Layout Primitives
 * @description Provides the compact page stack, action row, toolbar, and table surface contracts used by administration managers.
 * @logic Keep the shell breadcrumb as the single page title and normalize only page-level actions and content surfaces.
 * @dependencies React
 * @index_tags admin,layout,actions,toolbar,table
 * @author holic512
 */

import type { HTMLAttributes } from 'react'

export function AdminPage({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`admin-page-stack ${className}`.trim()} {...props}>{children}</div>
}

export function AdminPageActions({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`admin-page-actions ${className}`.trim()} {...props}>{children}</div>
}

export function AdminToolbar({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={`admin-toolbar-card ${className}`.trim()} {...props}>{children}</section>
}

export function AdminTablePanel({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={`admin-table-card ${className}`.trim()} {...props}>{children}</section>
}
