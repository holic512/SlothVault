/**
 * @file invitation-page.tsx
 * @project SlothVault
 * @module Public commission invitation
 * @description Inspect invitation validity and explicitly bind the authenticated customer account.
 * @logic Keep tokens out of query cache keys and preserve the same command id when retrying a claim.
 * @dependencies React, plugin client SDK, commissions DTOs
 * @index_tags commissions,invitation,account
 * @author holic512
 */
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, PluginPage, usePluginAccount } from '@slothvault/plugin-sdk/client'
import { API, type CommandResult } from './domain'
import { ErrorNotice, Loading, get, pageUrl, post, useDate, useUrlValue } from './ui'
export default function InvitationPage() {
  const token = useUrlValue('token'),
    account = usePluginAccount(),
    date = useDate(),
    identity = useRef('')
  const [invitation, setInvitation] = useState<{ valid: boolean; expiresAt: string } | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!token) return
    let active = true
    get<{ valid: boolean; expiresAt: string }>(API.invitation, { token }).then(value => {
      if (active) {
        setInvitation(value)
        setError(null)
      }
    }).catch(cause => {
      if (active) setError(cause)
    })
    return () => {
      active = false
    }
  }, [token, attempt])
  return <PluginPage className="commissions commission-public">
    <h1>认领委托邀请</h1>
    <p>邀请会把委托绑定到你当前的账户。认领不是确认合同，也不需要钱包。</p>
    <ErrorNotice error={error} retry={() => setAttempt(value => value + 1)} />
    {!token
      ? <Alert type="warning" title="缺少邀请凭证" description="请使用管理员发送的完整邀请链接。" />
      : !invitation && !error
        ? <Loading />
        : invitation?.valid
          ? <>
            <p>有效期至：{date(invitation.expiresAt)}</p>
            {account === undefined
              ? <Loading />
              : !account
                ? <Alert
                  type="info"
                  title="请先登录接收委托的客户账户"
                  description={<a href={`/login?next=${encodeURIComponent(`/extensions/slothvault.commissions/invitation?token=${encodeURIComponent(token)}`)}`}>登录后继续认领</a>}
                />
                : <>
                  <Alert
                    type="info"
                    title={`当前账户：${account.displayName || account.username}`}
                    description="请确认这是接收本委托的正确账户。绑定后可查看私有需求、合同及已共享文件。"
                  />
                  <Button
                    type="primary"
                    loading={busy}
                    onClick={async () => {
                      if (busy) return
                      setBusy(true)
                      setError(null)
                      identity.current ||= crypto.randomUUID()
                      try {
                        const result = await post<CommandResult>(API.claim, { commandId: identity.current, revision: 0, token })
                        window.location.assign(pageUrl(false, 'account', { commissionId: result.detail.commission.id }))
                      } catch (cause) {
                        setError(cause)
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >将委托绑定到当前账户</Button>
                </>}
          </>
          : invitation && <Alert type="warning" title="邀请已失效或已被认领" description="请联系管理员重新生成邀请链接；旧链接不能重复使用。" />}
  </PluginPage>
}
