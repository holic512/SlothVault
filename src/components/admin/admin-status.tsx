'use client'

import { Badge, Select, Tag, type SelectProps } from 'antd'

export const ADMIN_STATUS_OPTIONS = [
  { label: 'Active', value: 1 },
  { label: 'Inactive', value: 0 }
]

export function AdminStatusSelect(props: SelectProps<number>) {
  return <Select<number> options={ADMIN_STATUS_OPTIONS} {...props} />
}

export function renderStatusBadge(status: number | null | undefined) {
  const active = status === 1
  return <Badge status={active ? 'success' : 'default'} text={active ? 'Active' : 'Inactive'} />
}

export function renderAuthTag(value: boolean) {
  return value ? <Tag color="orange">Protected</Tag> : <Tag color="green">Public</Tag>
}
