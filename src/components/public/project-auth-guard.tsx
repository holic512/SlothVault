'use client'

import { App, Alert, Button, Flex, Spin, Typography } from 'antd'
import { Transaction } from '@solana/web3.js'
import { useQueryClient } from '@tanstack/react-query'
import { PropsWithChildren, useEffect, useState } from 'react'

import { apiFetch } from '@/lib/http'
import { useWalletStore } from '@/store/wallet'

type VerifyResponse = {
  hasAccess: boolean
  reason: string
  requireAuth: boolean
  assetId?: string
  network: 'mainnet' | 'devnet'
  purchaseEnabled: boolean
  priceLamports?: string
  priceSol?: string
  currency?: 'SOL'
}

type Props = PropsWithChildren<{
  projectId: string
}>

function base64ToBytes(base64: string) {
  const binary = window.atob(base64)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return window.btoa(binary)
}

export function ProjectAuthGuard({ projectId, children }: Props) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const wallet = useWalletStore()
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<VerifyResponse | null>(null)
  const [refreshSeed, setRefreshSeed] = useState(0)
  const [purchasing, setPurchasing] = useState(false)

  useEffect(() => {
    let active = true

    const run = async () => {
      setLoading(true)
      try {
        const result = await apiFetch<VerifyResponse>(`/api/project/${projectId}/verify-access`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress: wallet.publicKey || undefined,
          }),
        })

        if (active) {
          setState(result)
        }
      } catch (error: any) {
        if (active) {
          setState({
            hasAccess: false,
            reason: error.message,
            requireAuth: true,
            network: 'devnet',
            purchaseEnabled: false,
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
  }, [projectId, refreshSeed, wallet.publicKey])

  const refreshAccess = async () => {
    await queryClient.invalidateQueries({
      predicate: (query) => Array.isArray(query.queryKey) && query.queryKey.includes(projectId),
    })
    setRefreshSeed((value) => value + 1)
  }

  const pollPurchaseStatus = async (purchaseId: string) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await apiFetch<any>(`/api/project/${projectId}/purchase/${purchaseId}`)

      if (result.status === 2) {
        return
      }

      if (result.status === -1 || result.status === -2) {
        throw new Error(result.failureReason || 'Purchase failed')
      }

      await new Promise((resolve) => setTimeout(resolve, 1500))
    }

    throw new Error('Purchase confirmation timed out')
  }

  const handlePurchase = async () => {
    const phantom = typeof window !== 'undefined' ? (window as any).solana : null
    if (!wallet.publicKey || !phantom?.signTransaction) {
      message.error('Phantom wallet is required to complete the purchase.')
      return
    }

    setPurchasing(true)
    try {
      const prepared = await apiFetch<{
        sessionId: string
        purchaseId: string
        serializedTransactionBase64: string
      }>(`/api/project/${projectId}/purchase/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerWalletAddress: wallet.publicKey,
        }),
      })

      const transaction = Transaction.from(base64ToBytes(prepared.serializedTransactionBase64))
      const signedTransaction = await phantom.signTransaction(transaction)
      const signedTransactionBase64 = bytesToBase64(
        signedTransaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        })
      )

      const submitted = await apiFetch<any>(`/api/project/${projectId}/purchase/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: prepared.sessionId,
          signedTransactionBase64,
        }),
      })

      if (submitted.status !== 2) {
        await pollPurchaseStatus(prepared.purchaseId)
      }

      message.success('Purchase completed. Access granted.')
      setState((current) =>
        current
          ? {
              ...current,
              hasAccess: true,
              reason: 'Access granted',
            }
          : current
      )
      await refreshAccess()
    } catch (error: any) {
      message.error(error.message || 'Purchase failed')
    } finally {
      setPurchasing(false)
    }
  }

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
        <Alert type={state.purchaseEnabled ? 'warning' : 'error'} message={state.reason || 'Access denied'} />
        {state.purchaseEnabled ? (
          <>
            <Typography.Text>
              Price: {state.priceSol || '--'} {state.currency || 'SOL'} ({state.network})
            </Typography.Text>
            <Button type="primary" loading={purchasing} onClick={() => void handlePurchase()}>
              Buy Access
            </Button>
          </>
        ) : (
          <Typography.Text type="secondary">
            This project requires manual cNFT issuance by the administrator.
          </Typography.Text>
        )}
        <Button onClick={() => void refreshAccess()}>Retry</Button>
      </Flex>
    )
  }

  return <>{children}</>
}
