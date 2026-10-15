'use client'
/**
 * @file account-security-view.tsx
 * @project SlothVault
 * @module Personal Account Security
 * @description Presents username/password credentials, monthly rename quota, and independently manageable wallet bindings.
 * @logic Determine an operation target, reauthenticate using an existing credential, prove new wallet ownership, and synchronize account-scoped caches; password changes sign out all sessions.
 * @dependencies React Query, Ant Design, wallet runtime and connection, personal security APIs
 * @index_tags account,credentials,username,quota,multi-wallet,reauthentication
 * @author holic512
 */
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Input, Modal, Space, Typography } from 'antd'
import { KeyRound, WalletCards } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useAccountUser } from '@/components/account/account-shell'
import { AccountCard } from '@/components/account/account-card'
import { WalletRuntime } from '@/components/providers/wallet-runtime'
import { useSolanaWallet } from '@/components/wallet/use-solana-wallet'
import { signWalletMessage, type ConnectedWallet } from '@/components/wallet/wallet-connection'
import { accountSecurityErrorReason } from '@/lib/account-security-error'
import styles from '@/styles/modules/account.module.css'
import { replaceClientSession } from '@/lib/session-client'
import { apiFetch } from '@/lib/api-client'
import type { AccountAction, AccountCredentials, CredentialsMutationResult, ReauthenticationProof, WalletBinding, WalletChallenge, WalletMutationResult, WalletProof } from '@/types/account-security'
type CredentialValues = { username: string; newPassword?: string; confirmPassword?: string }
type ProofRequest = { target: AccountAction; passwordOnly: boolean; resolve: (proof: ReauthenticationProof) => void; reject: (error: Error) => void }
export function AccountSecurityView() { return <WalletRuntime><SecurityContent /></WalletRuntime> }
function SecurityContent() {
  const t = useTranslations('AccountSecurity'), common = useTranslations('WalletConnection'), locale = useLocale()
  const user = useAccountUser(), wallet = useSolanaWallet(), client = useQueryClient(), router = useRouter(), { message } = App.useApp()
  const [form] = Form.useForm<CredentialValues>(), [busy, setBusy] = useState(false), [phase, setPhase] = useState('idle')
  const lock = useRef(false), proofLock = useRef(false), proofRef = useRef<ProofRequest | null>(null)
  const [proofRequest, setProofRequest] = useState<ProofRequest | null>(null), [password, setPassword] = useState(''), [proofBusy, setProofBusy] = useState(false)
  const walletsKey = ['account-wallets', user.id], credentialsKey = ['account-credentials', user.id]
  const walletsQuery = useQuery({ queryKey: walletsKey, queryFn: () => apiFetch<WalletBinding[]>('/api/account/wallets') })
  const credentialsQuery = useQuery({ queryKey: credentialsKey, queryFn: () => apiFetch<AccountCredentials>('/api/account/credentials') })
  const wallets = walletsQuery.data ?? [], credentials = credentialsQuery.data
  useEffect(() => () => { proofRef.current?.reject(new Error('cancelled')); proofRef.current = null }, [])
  const showError = (error: unknown) => {
    const reason = accountSecurityErrorReason(error)
    if (reason === 'SESSION_CHANGED') { void replaceClientSession(client, null).then(() => { router.replace('/login'); router.refresh() }) }
    if (reason !== 'WALLET_CANCELLED') message.error(common.has(`errors.${reason}`) ? common(`errors.${reason}`) : common('errors.WALLET_OPERATION_FAILED'))
  }
  const run = async (operation: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try { await operation() } catch (error) { showError(error) } finally { lock.current = false; setBusy(false); setPhase('idle') }
  }
  const reauthenticate = (target: AccountAction, passwordOnly = false) => {
    setPhase('reauth'); setPassword('')
    return new Promise<ReauthenticationProof>((resolve, reject) => { const request = { target, passwordOnly, resolve, reject }; proofRef.current = request; setProofRequest(request) })
  }
  const finishProof = (proof?: ReauthenticationProof) => {
    if (proof) proofRef.current?.resolve(proof); else proofRef.current?.reject(new Error('cancelled'))
    proofRef.current = null; setProofRequest(null)
  }
  const walletProof = async (snapshot: ConnectedWallet, purpose: 'bind' | 'replace' | 'reauth', target: AccountAction): Promise<WalletProof> => {
    const challenge = await apiFetch<WalletChallenge>('/api/auth/wallet/challenge', { method: 'POST', body: JSON.stringify({ purpose, address: snapshot.address, target }) })
    const signed = await signWalletMessage(snapshot, challenge.message, wallet.currentAdapter)
    return { challengeId: challenge.challengeId, ...signed }
  }
  const proveExistingWallet = async () => {
    if (!proofRequest || proofLock.current) return
    proofLock.current = true; setProofBusy(true)
    try {
      const snapshot = await wallet.requestConnection({ forceSelect: true })
      if (!wallets.some(binding => binding.address === snapshot.address)) throw { reason: 'WALLET_NOT_BOUND' }
      finishProof({ method: 'wallet', ...await walletProof(snapshot, 'reauth', proofRequest.target) })
    } catch (error) { showError(error) } finally { proofLock.current = false; setProofBusy(false) }
  }
  const applyWallets = (result: WalletMutationResult) => { client.setQueryData(['session-user'], result.user); client.setQueryData(['account-wallets', result.user.id], result.wallets); message.success(t('walletUpdated')) }
  const bindOrReplace = (old?: WalletBinding) => run(async () => {
    setPhase('connecting')
    const selected = await wallet.requestConnection({ forceSelect: true })
    const target: AccountAction = old ? { action: 'replace', walletId: old.id, address: selected.address } : { action: 'bind', address: selected.address }
    const reauth = await reauthenticate(target)
    setPhase('signing')
    const snapshot = await wallet.requestConnection({ expectedAddress: selected.address, preferredWalletName: selected.name })
    const proof = await walletProof(snapshot, old ? 'replace' : 'bind', target)
    setPhase('verifying')
    applyWallets(await apiFetch<WalletMutationResult>(old ? `/api/account/wallets/${old.id}/replace` : '/api/account/wallets', { method: 'POST', body: JSON.stringify({ ...proof, reauth }) }))
  })
  const unbind = (binding: WalletBinding) => run(async () => {
    if (wallets.length === 1 && !user.passwordConfigured) { message.warning(t('lastWalletSetup')); return }
    const reauth = await reauthenticate({ action: 'unbind', walletId: binding.id }, wallets.length === 1)
    setPhase('verifying')
    applyWallets(await apiFetch<WalletMutationResult>(`/api/account/wallets/${binding.id}`, { method: 'DELETE', body: JSON.stringify({ reauth }) }))
  })
  const save = (values: CredentialValues) => run(async () => {
    const username = values.username.trim().toLowerCase(), newPassword = values.newPassword || undefined
    const renamed = username !== user.username
    if (!renamed && !newPassword) return
    const changes = { ...(renamed ? { username } : {}), ...(newPassword ? { newPassword } : {}) }
    const reauth = await reauthenticate({ action: 'credentials', ...(renamed ? { username } : {}), passwordChange: Boolean(newPassword) })
    setPhase('verifying')
    const result = await apiFetch<CredentialsMutationResult>('/api/account/credentials', { method: 'PATCH', body: JSON.stringify({ ...changes, reauth }) })
    message.success(result.passwordChanged ? t('passwordUpdated') : t('credentialsUpdated'))
    form.resetFields(['newPassword', 'confirmPassword'])
    client.setQueryData(['account-credentials', result.user.id], result.credentials); client.setQueryData(['session-user'], result.user)
    if (result.passwordChanged) { await replaceClientSession(client, null); router.replace('/login'); router.refresh() }
  })
  const quota = credentials?.usernameChangeQuota
  return <div className="account-route">
    <div className="account-security-grid">
      <AccountCard className="account-route-card" title={<span className="account-card-title"><KeyRound size={16} />{t('credentialsTitle')}</span>}>
        {!user.passwordConfigured ? <Alert type="info" showIcon title={t('walletAccountHint')} /> : null}
        {credentialsQuery.isError ? <Alert type="error" title={t('loadFailed')} action={<Button onClick={() => void credentialsQuery.refetch()}>{t('retry')}</Button>} /> : null}
        <Form form={form} layout="vertical" initialValues={{ username: user.username }} onFinish={values => void save(values)} disabled={busy}>
          <Form.Item name="username" label={t('username')} rules={[{ required: true }, { transform: (value: unknown) => typeof value === 'string' ? value.trim() : value, pattern: /^[A-Za-z0-9_]{3,32}$/, message: t('usernameRule') }]}><Input autoComplete="username" disabled={busy || quota?.remaining === 0} maxLength={32} /></Form.Item>
          {quota ? <div className="account-username-quota"><Typography.Text type="secondary">{t('quota', { remaining: quota.remaining, limit: quota.limit })}</Typography.Text><Typography.Text type="secondary">{t('quotaReset', { date: new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(quota.resetsAt)) })}</Typography.Text></div> : null}
          <Form.Item name="newPassword" label={user.passwordConfigured ? t('newPassword') : t('setPassword')} rules={[{ min: 8, message: t('passwordMin') }]}><Input.Password autoComplete="new-password" maxLength={256} /></Form.Item>
          <Form.Item name="confirmPassword" label={t('confirmPassword')} dependencies={['newPassword']} rules={[({ getFieldValue }) => ({ validator: async (_, value) => { if (!getFieldValue('newPassword') || value === getFieldValue('newPassword')) return; throw new Error(t('passwordMismatch')) } })]}><Input.Password autoComplete="new-password" maxLength={256} /></Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>{t('save')}</Button>
        </Form>
      </AccountCard>
      <AccountCard className="account-route-card" title={<span className="account-card-title"><WalletCards size={16} />{t('walletTitle')}</span>}>
        <Typography.Paragraph type="secondary">{t('walletHint')}</Typography.Paragraph>
        {walletsQuery.isError ? <Alert type="error" title={t('loadFailed')} action={<Button onClick={() => void walletsQuery.refetch()}>{t('retry')}</Button>} /> : null}
        {!wallets.length ? <Typography.Paragraph type="secondary">{walletsQuery.isPending ? t('loading') : t('noWallets')}</Typography.Paragraph> : null}
        <div className="account-wallet-list">{wallets.map(binding => <div className="account-wallet-binding" key={binding.id}>
          <Typography.Paragraph copyable={{ text: binding.address }} className={`${styles['wallet-address']} account-wallet-address`}><code>{binding.address}</code></Typography.Paragraph>
          <Space wrap><Button disabled={busy} onClick={() => void bindOrReplace(binding)}>{t('replace')}</Button><Button danger disabled={busy} onClick={() => void unbind(binding)}>{t('unbind')}</Button></Space>
        </div>)}</div>
        <Button block disabled={busy || walletsQuery.isPending || walletsQuery.isError} onClick={() => void bindOrReplace()}>{t('addWallet')}</Button>
        {wallet.address ? <Typography.Paragraph className="account-connected-wallet" type="secondary">{t('connected', { wallet: wallet.walletName ?? '', address: `${wallet.address.slice(0, 6)}…${wallet.address.slice(-6)}` })} <Button type="link" size="small" disabled={busy} onClick={wallet.openWalletSelector}>{common('actions.switch')}</Button></Typography.Paragraph> : null}
        {busy ? <Typography.Paragraph role="status">{common(`phases.${phase}`)}</Typography.Paragraph> : null}
      </AccountCard>
    </div>
    <Modal open={Boolean(proofRequest)} title={t('reauthTitle')} onCancel={() => { if (!proofLock.current) finishProof() }} footer={null} closable={!proofBusy} maskClosable={false}>
      <Typography.Paragraph>{proofRequest?.passwordOnly ? t('lastWalletPassword') : t('reauthHint')}</Typography.Paragraph>
      {proofRequest && 'address' in proofRequest.target ? <Typography.Paragraph className={`${styles['wallet-address']} account-wallet-address`}><code>{proofRequest.target.address}</code></Typography.Paragraph> : null}
      {user.passwordConfigured ? <Space orientation="vertical" className={styles['reauth-controls']}><Input.Password aria-label={t('currentPassword')} placeholder={t('currentPassword')} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={proofBusy} /><Button type="primary" block disabled={!password || proofBusy} onClick={() => finishProof({ method: 'password', password })}>{t('verifyPassword')}</Button></Space> : null}
      {!proofRequest?.passwordOnly ? <Button block loading={proofBusy} disabled={!wallets.length} onClick={() => void proveExistingWallet()}>{t('verifyWallet')}</Button> : null}
    </Modal>
  </div>
}
