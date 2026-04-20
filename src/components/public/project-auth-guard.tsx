'use client'

import { Alert, Button, Flex, Spin } from 'antd'
import { PropsWithChildren, useEffect, useState } from 'react'

import { apiFetch } from '@/lib/http'
import { useWalletStore } from '@/store/wallet'

type VerifyResponse = {
  hasAccess: boolean
  reason: string
  requireAuth: boolean
  assetId?: string
}

type Props = PropsWithChildren<{
  projectId: string
}>

export function ProjectAuthGuard({ projectId, children }: Props) {
  const wallet = useWalletStore()
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<VerifyResponse | null>(null)

  useEffect(() => {
    let active = true

    const run = async () => {
      setLoading(true)
      try {
        const result = await apiFetch<VerifyResponse>(`/api/project/${projectId}/verify-access`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress: wallet.publicKey || undefined
          })
        })
        if (active) {
          setState(result)
        }
      } catch (error: any) {
        if (active) {
          setState({
            hasAccess: false,
            reason: error.message,
            requireAuth: true
          })
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void run()
    return () => {
      active = false
    }
  }, [projectId, wallet.publicKey])

  if (loading) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: 320 }}>
        <Spin size="large" />
      </Flex>
    )
  }

  if (state?.requireAuth && !wallet.connected) {
    return (
      <Flex vertical gap={16} align="center" justify="center" style={{ minHeight: 320 }}>
        <Alert type="info" message="This project requires wallet authentication." />
        <Button type="primary" onClick={() => void wallet.connect()}>
          Connect Phantom
        </Button>
      </Flex>
    )
  }

  if (state?.requireAuth && !state.hasAccess) {
    return (
      <Flex vertical gap={16} align="center" justify="center" style={{ minHeight: 320 }}>
        <Alert type="error" message={state.reason || 'Access denied'} />
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </Flex>
    )
  }

  return <>{children}</>
}
