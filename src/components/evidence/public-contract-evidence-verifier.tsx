'use client'

/**
 * @file public-contract-evidence-verifier.tsx
 * @project SlothVault
 * @module Public Contract Evidence Verifier
 * @description Provides an opt-in live Solana verification control for the privacy-preserving public contract receipt.
 * @logic Query only the public receipt endpoint, display chain agreement without loading private contract data, and retain failures as non-destructive verification outcomes.
 * @dependencies Ant Design, contract evidence API client
 * @index_tags public,contracts,evidence,verification,solana,privacy
 * @author holic512
 */
import { useState } from 'react'

import { Alert, Button } from 'antd'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { apiFetch } from '@/lib/api-client'

export function PublicContractEvidenceVerifier({ signature }: { signature: string }) {
  const t = useTranslations('Evidence.live')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ verified: boolean; message: string } | null>(null)
  const verify = async () => {
    setLoading(true)
    try {
      const response = await apiFetch<{ verified: boolean }>(`/api/contract-evidence/${signature}?live=1`)
      setResult({
        verified: response.verified,
        message: response.verified
          ? t('contractVerified')
          : t('contractUnverified'),
      })
    } catch (error) {
      setResult({ verified: false, message: error instanceof Error ? error.message : t('failed') })
    } finally {
      setLoading(false)
    }
  }
  return <div className="evidence-live-check">
    <Button type="primary" icon={<RefreshCw size={15} />} loading={loading} onClick={() => void verify()}>{t('action')}</Button>
    {result ? <Alert showIcon type={result.verified ? 'success' : 'warning'} icon={result.verified ? <ShieldCheck size={16} /> : undefined} title={result.verified ? t('passed') : t('notPassed')} description={result.message} /> : null}
  </div>
}
