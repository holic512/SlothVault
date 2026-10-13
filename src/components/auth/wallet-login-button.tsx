'use client'
/**
 * @file wallet-login-button.tsx
 * @project SlothVault
 * @module Optional Wallet Login UI
 * @description Runs explicit personal wallet login through the same connection boundary as administration.
 * @logic Await user-selected connection, sign a login-only challenge with a stable account, verify and refresh the ordinary session; never authenticate on auto-reconnect.
 * @dependencies wallet runtime, wallet connection, React Query, auth API
 * @index_tags wallet,login,connection,signature,client
 * @author holic512
 */
import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App, Button, Typography } from 'antd'
import { WalletCards } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { WalletRuntime } from '@/components/providers/wallet-runtime'
import { useSolanaWallet } from '@/components/wallet/use-solana-wallet'
import { signWalletMessage } from '@/components/wallet/wallet-connection'
import { accountSecurityErrorReason } from '@/lib/account-security-error'
import { apiFetch } from '@/lib/api-client'
import type { WalletChallenge } from '@/types/account-security'
import type { SessionUser } from '@/types/user'
type LoginButtonProps = { redirectTo?: string; disabled?: boolean; onBusyChange?: (busy: boolean) => void }
export function WalletLoginButton({ redirectTo = '/account', ...props }: LoginButtonProps) {
  return <WalletRuntime><WalletLoginButtonContent redirectTo={redirectTo} {...props} /></WalletRuntime>
}
function WalletLoginButtonContent({ redirectTo, disabled, onBusyChange }: LoginButtonProps & { redirectTo: string }) {
  const t = useTranslations('UserAuth.wallet'), common = useTranslations('WalletConnection')
  const wallet = useSolanaWallet(), queryClient = useQueryClient(), router = useRouter(), { message } = App.useApp()
  const [phase, setPhase] = useState('idle'), locked = useRef(false)
  const mutation = useMutation({
    mutationFn: async () => {
      setPhase('connecting')
      const snapshot = await wallet.requestConnection()
      setPhase('signing')
      const challenge = await apiFetch<WalletChallenge>('/api/auth/wallet/challenge', { method: 'POST', body: JSON.stringify({ purpose: 'login', address: snapshot.address }) })
      const proof = await signWalletMessage(snapshot, challenge.message, wallet.currentAdapter)
      setPhase('verifying')
      return apiFetch<SessionUser>('/api/auth/wallet/verify', { method: 'POST', body: JSON.stringify({ challengeId: challenge.challengeId, ...proof }) })
    },
    onSuccess: async user => { message.success(t('loginSuccess')); queryClient.setQueryData(['session-user'], user); router.replace(redirectTo); router.refresh() },
    onError: error => { const reason = accountSecurityErrorReason(error); if (reason !== 'WALLET_CANCELLED') message.error(common.has(`errors.${reason}`) ? common(`errors.${reason}`) : common('errors.WALLET_OPERATION_FAILED')) },
    onSettled: () => { locked.current = false; onBusyChange?.(false); setPhase('idle') },
  })
  return <>
    <Button block aria-haspopup="dialog" aria-expanded={wallet.pickerOpen} disabled={disabled} icon={<WalletCards size={16} />} loading={mutation.isPending} onClick={() => { if (disabled || locked.current) return; locked.current = true; onBusyChange?.(true); mutation.mutate() }}>{mutation.isPending ? common(`phases.${phase}`) : wallet.connected ? t('login') : t('select')}</Button>
    {wallet.address ? <Typography.Paragraph className="auth-footnote" type="secondary">{wallet.walletName} · <code>{wallet.address.slice(0, 6)}…{wallet.address.slice(-6)}</code> <Button type="link" size="small" disabled={disabled || mutation.isPending} onClick={wallet.openWalletSelector}>{common('actions.switch')}</Button></Typography.Paragraph> : null}
  </>
}
