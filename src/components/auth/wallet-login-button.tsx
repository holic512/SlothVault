'use client'

/**
 * @file wallet-login-button.tsx
 * @project SlothVault
 * @module Optional Wallet Login UI
 * @description Offers Solana address ownership as one optional login or account-binding method inside conventional account screens.
 * @logic Open wallet selection when disconnected, request a process-local one-time challenge, sign its exact message, verify it server-side, and refresh the ordinary cookie session.
 * @dependencies Solana Wallet Adapter, bs58, Ant Design, auth API
 * @index_tags wallet,login,binding,optional-auth,client
 * @author holic512
 */
import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App, Button } from 'antd'
import bs58 from 'bs58'
import { WalletCards } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { WalletRuntime } from '@/components/providers/wallet-runtime'
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
  const { publicKey, connected, signMessage } = useWallet()
  const { setVisible } = useWalletModal()
  const queryClient = useQueryClient()
  const router = useRouter()
  const { message } = App.useApp()

  const mutation = useMutation({
    mutationFn: async () => {
      if (!connected || !publicKey) {
        setVisible(true)
        return null
      }
      if (!signMessage) throw new Error('当前钱包不支持消息签名')
      const address = publicKey.toBase58()
      const challenge = await apiFetch<Challenge>('/api/auth/wallet/challenge', {
        method: 'POST',
        body: JSON.stringify({ address }),
      })
      const signature = bs58.encode(
        await signMessage(new TextEncoder().encode(challenge.message)),
      )
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
      {!connected
        ? '选择钱包'
        : mode === 'bind'
          ? '签名并绑定钱包地址'
          : '使用钱包地址登录'}
    </Button>
  )
}
