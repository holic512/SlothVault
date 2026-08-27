'use client'

/**
 * @file wallet-login-button.tsx
 * @project SlothVault
 * @module Optional Wallet Login UI
 * @description Offers Solana address ownership as one optional login or account-binding method inside conventional account screens.
 * @logic Open wallet selection when disconnected, request a process-local one-time challenge, sign its exact message, verify it server-side, and refresh the ordinary cookie session.
 * @dependencies use-solana-wallet, Ant Design, auth API
 * @index_tags wallet,login,binding,optional-auth,client
 * @author holic512
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App, Button } from 'antd'
import { WalletCards } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { WalletRuntime } from '@/components/providers/wallet-runtime'
import { useSolanaWallet } from '@/components/wallet/use-solana-wallet'
import { apiFetch } from '@/lib/api-client'
import type { SessionUser } from '@/types/user'

type Challenge = {
  challengeId: string
  address: string
  message: string
  expiresAt: number
}

export function WalletLoginButton({
  mode = 'login',
  redirectTo = '/account',
}: {
  mode?: 'login' | 'bind'
  redirectTo?: string
}) {
  return (
    <WalletRuntime>
      <WalletLoginButtonContent mode={mode} redirectTo={redirectTo} />
    </WalletRuntime>
  )
}

function WalletLoginButtonContent({
  mode,
  redirectTo,
}: {
  mode: 'login' | 'bind'
  redirectTo: string
}) {
  const wallet = useSolanaWallet()
  const queryClient = useQueryClient()
  const router = useRouter()
  const { message } = App.useApp()

  const mutation = useMutation({
    mutationFn: async () => {
      if (!wallet.connected || !wallet.address) {
        wallet.openWalletSelector()
        return null
      }
      const challenge = await apiFetch<Challenge>('/api/auth/wallet/challenge', {
        method: 'POST',
        body: JSON.stringify({ address: wallet.address }),
      })
      const { address, signature } = await wallet.signLoginMessage(challenge.message)
      return apiFetch<SessionUser>('/api/auth/wallet/verify', {
        method: 'POST',
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          address,
          signature,
        }),
      })
    },
    onSuccess: async (user) => {
      if (!user) return
      message.success(mode === 'bind' ? '钱包地址已绑定' : '登录成功')
      await queryClient.invalidateQueries({ queryKey: ['session-user'] })
      router.replace(redirectTo)
      router.refresh()
    },
    onError: (error) => message.error(error.message),
  })

  return (
    <Button
      block
      icon={<WalletCards size={16} />}
      loading={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      {!wallet.connected
        ? '选择钱包'
        : mode === 'bind'
          ? '签名并绑定钱包地址'
          : '使用钱包地址登录'}
    </Button>
  )
}
