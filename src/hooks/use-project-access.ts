'use client'

/**
 * @file use-project-access.ts
 * @project SlothVault
 * @module Project Access Client
 * @description Coordinates wallet connection, signed access proofs, short-lived browser caching, and server verification.
 * @logic Reuse a fresh proof when possible, otherwise request an Ed25519 signature and exchange it for an authorization decision.
 * @dependencies Solana Wallet Adapter, bs58, React, api-client, wallet-proof contract
 * @index_tags hook,wallet,project-auth,signature
 * @author holic512
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import bs58 from 'bs58'

import { apiFetch } from '@/lib/api-client'
import {
  buildWalletAccessMessage,
  WALLET_PROOF_MAX_AGE_MS,
  type WalletProof,
} from '@/lib/wallet-proof'

type AccessResponse = {
  hasAccess: boolean
  reason: string
  assetId?: string
  requireAuth: boolean
}

type AccessState = {
  scope: string
  hasAccess: boolean
  loading: boolean
  reason: string
  proof: WalletProof | null
}

function storageKey(projectId: string, address: string) {
  return `slothvault:proof:${projectId}:${address}`
}

function isFresh(proof: WalletProof) {
  return Date.now() - proof.timestamp < WALLET_PROOF_MAX_AGE_MS - 15_000
}

export function useProjectAccess(projectId: string, requireAuth: boolean | undefined) {
  const { connected, publicKey, signMessage } = useWallet()
  const { setVisible } = useWalletModal()
  const address = publicKey?.toBase58() || null
  const scope = address ? `${projectId}:${address}` : projectId
  const [accessState, setAccessState] = useState<AccessState>({
    scope: '',
    hasAccess: false,
    loading: false,
    reason: '',
    proof: null,
  })

  const verify = useCallback(
    async (candidate: WalletProof, forceChainVerify = false) => {
      return apiFetch<AccessResponse>(`/api/project/${projectId}/verify-access`, {
        method: 'POST',
        body: JSON.stringify({
          walletAddress: candidate.address,
          signature: candidate.signature,
          timestamp: candidate.timestamp,
          forceChainVerify,
        }),
      })
    },
    [projectId],
  )

  useEffect(() => {
    if (!requireAuth || !connected || !address) return

    let cancelled = false
    const restoreCachedProof = async () => {
      // Keep state transitions asynchronous because this effect synchronizes with
      // sessionStorage and the remote authorization service.
      await Promise.resolve()
      const key = storageKey(projectId, address)
      const cached = window.sessionStorage.getItem(key)
      if (!cached) {
        if (!cancelled) {
          setAccessState({
            scope,
            hasAccess: false,
            loading: false,
            reason: 'Sign a short-lived access proof to continue',
            proof: null,
          })
        }
        return
      }

      try {
        const candidate = JSON.parse(cached) as WalletProof
        if (candidate.address !== address || !isFresh(candidate)) {
          window.sessionStorage.removeItem(key)
          if (!cancelled) {
            setAccessState({
              scope,
              hasAccess: false,
              loading: false,
              reason: 'Sign a short-lived access proof to continue',
              proof: null,
            })
          }
          return
        }

        const result = await verify(candidate)
        if (!result.hasAccess) window.sessionStorage.removeItem(key)
        if (!cancelled) {
          setAccessState({
            scope,
            hasAccess: result.hasAccess,
            loading: false,
            reason: result.reason,
            proof: result.hasAccess ? candidate : null,
          })
        }
      } catch (error) {
        window.sessionStorage.removeItem(key)
        if (!cancelled) {
          setAccessState({
            scope,
            hasAccess: false,
            loading: false,
            reason: error instanceof Error ? error.message : 'Wallet verification failed',
            proof: null,
          })
        }
      }
    }

    void restoreCachedProof()
    return () => {
      cancelled = true
    }
  }, [address, connected, projectId, requireAuth, scope, verify])

  const authorize = useCallback(
    async (forceChainVerify = false) => {
      if (!connected || !publicKey) {
        setVisible(true)
        return false
      }
      if (!signMessage) {
        setAccessState({
          scope,
          hasAccess: false,
          loading: false,
          reason: 'This wallet does not support message signing',
          proof: null,
        })
        return false
      }

      setAccessState({ scope, hasAccess: false, loading: true, reason: 'Verifying access', proof: null })
      try {
        const walletAddress = publicKey.toBase58()
        const timestamp = Date.now()
        const message = new TextEncoder().encode(
          buildWalletAccessMessage(projectId, walletAddress, timestamp),
        )
        const signature = bs58.encode(await signMessage(message))
        const candidate = { address: walletAddress, signature, timestamp }
        const result = await verify(candidate, forceChainVerify)
        setAccessState({
          scope,
          hasAccess: result.hasAccess,
          loading: false,
          reason: result.reason,
          proof: result.hasAccess ? candidate : null,
        })
        if (result.hasAccess) {
          window.sessionStorage.setItem(
            storageKey(projectId, walletAddress),
            JSON.stringify(candidate),
          )
        }
        return result.hasAccess
      } catch (error) {
        setAccessState({
          scope,
          hasAccess: false,
          loading: false,
          reason: error instanceof Error ? error.message : 'Wallet verification failed',
          proof: null,
        })
        return false
      }
    },
    [connected, projectId, publicKey, scope, setVisible, signMessage, verify],
  )

  const currentState = accessState.scope === scope ? accessState : null
  const isPublic = requireAuth === false
  const hasAccess = isPublic ? true : Boolean(requireAuth && connected && currentState?.hasAccess)
  const loading = isPublic
    ? false
    : Boolean(requireAuth && connected && (!currentState || currentState.loading))
  const reason = isPublic
    ? 'Project is public'
    : requireAuth && !connected
      ? 'Connect a wallet to continue'
      : currentState?.reason || ''

  const headers = useMemo<Record<string, string>>(() => {
    const proof = currentState?.hasAccess ? currentState.proof : null
    if (!proof) return {} as Record<string, string>
    return {
      'x-wallet-address': proof.address,
      'x-wallet-signature': proof.signature,
      'x-wallet-timestamp': String(proof.timestamp),
    }
  }, [currentState])

  return {
    connected,
    publicKey: publicKey?.toBase58() || null,
    hasAccess,
    loading,
    reason,
    headers,
    authorize,
  }
}
