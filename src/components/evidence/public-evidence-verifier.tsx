'use client'

import { useState } from 'react'

import { Alert, Button } from 'antd'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { apiFetch } from '@/lib/api-client'

export function PublicEvidenceVerifier({ signature }: { signature: string }) {
  const t = useTranslations('Evidence.live')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ verified: boolean; message: string } | null>(null)

  const verify = async () => {
    setLoading(true)
    try {
      const response = await apiFetch<{ verified: boolean }>(`/api/evidence/${signature}?live=1`)
      setResult({
        verified: response.verified,
        message: response.verified
          ? t('releaseVerified')
          : t('releaseUnverified'),
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
