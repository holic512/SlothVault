'use client'
/**
 * @file invitation-page.tsx
 * @project SlothVault
 * @module Invitation Claim Page
 * @description Guides visitors through login and explicit commission ownership claim.
 * @logic Read public invitation validity without private content and navigate only after authenticated claim succeeds.
 * @dependencies React Query, Ant Design, commission invitation API
 * @index_tags commissions,invite,login
 * @author holic512
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, App, Button, Card, Space, Typography } from 'antd'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'
import type { SessionUser } from '@/types/user'
export function CommissionInvitationPage({ token }: { token: string }) {
  const router = useRouter(), { message } = App.useApp()
  const invite = useQuery({ queryKey: ['commission-invitation', token], queryFn: () => apiFetch<{ status: string; expiresAt: string }>(`/api/commission-invitations/${token}`), retry: false })
  const session = useQuery({ queryKey: ['invitation-session'], queryFn: () => apiFetch<SessionUser | null>('/api/auth/session'), retry: false })
  const claim = useMutation({ mutationFn: () => apiFetch<{ id: string }>(`/api/commission-invitations/${token}`, { method: 'POST', body: '{}' }), onSuccess: (row) => router.replace(`/account/commissions/${row.id}`), onError: (error) => message.error(error.message) })
  const next = encodeURIComponent(`/commission-invitations/${token}`)
  return <main className="container"><Card style={{ maxWidth: 560, margin: '64px auto' }}><Typography.Title level={2}>委托邀请</Typography.Title><Typography.Paragraph>登录后认领此委托，即可查看需求、确认合同和跟进交付。</Typography.Paragraph>
    {invite.error ? <Alert type="error" title={invite.error.message} /> : null}
    {invite.data && ['EXPIRED', 'REVOKED'].includes(invite.data.status) ? <Alert type="warning" title="邀请已失效，请联系管理员重新发送" /> : null}
    {invite.data && ['AVAILABLE', 'CLAIMED'].includes(invite.data.status) ? session.data ? <Button type="primary" loading={claim.isPending} onClick={() => claim.mutate()}>{invite.data.status === 'CLAIMED' ? '打开已认领的委托' : '确认认领委托'}</Button> : <Space><Link href={`/login?next=${next}`}><Button type="primary">登录后认领</Button></Link><Link href={`/register?next=${next}`}><Button>注册账号</Button></Link></Space> : null}
  </Card></main>
}
