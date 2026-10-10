'use client'

import { useState } from 'react'

import { Alert, Button, Space, Tag } from 'antd'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { apiFetch } from '@/lib/api-client'

export function PublicEvidenceVerifier({ signature }: { signature: string }) {
  const t = useTranslations('Evidence.live')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ verified: boolean; chainVerified?: boolean; integrityVerified?: boolean | null; message?: string } | null>(null)

  const verify = async () => {
    setLoading(true)
    try {
      const response = await apiFetch<{ verified: boolean; chainVerified: boolean; integrityVerified: boolean | null }>(`/api/evidence/${signature}?live=1`)
      setResult(response)
    } catch (error) {
      setResult({ verified: false, message: error instanceof Error ? error.message : t('failed') })
    } finally {
      setLoading(false)
    }
  }

  return <div className="evidence-live-check">
    <Button type="primary" icon={<RefreshCw size={15} />} loading={loading} onClick={() => void verify()}>{t('action')}</Button>
    {result ? <Alert showIcon type={result.verified ? 'success' : 'warning'} icon={result.verified ? <ShieldCheck size={16} /> : undefined} title={result.verified ? t('passed') : t('notPassed')} description={result.message || <Space orientation="vertical"><span>{t('chain')} <Tag color={result.chainVerified ? 'success' : 'error'}>{t(result.chainVerified ? 'matched' : 'mismatched')}</Tag></span><span>{t('integrity')} <Tag color={result.integrityVerified === true ? 'success' : result.integrityVerified === false ? 'error' : 'default'}>{t(result.integrityVerified === null ? 'unavailable' : result.integrityVerified ? 'matched' : 'mismatched')}</Tag></span></Space>} /> : null}
  </div>
}
