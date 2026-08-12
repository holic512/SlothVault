'use client'

import { useState } from 'react'

import { Alert, Button } from 'antd'
import { RefreshCw, ShieldCheck } from 'lucide-react'

import { apiFetch } from '@/lib/api-client'

export function PublicEvidenceVerifier({ signature }: { signature: string }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ verified: boolean; message: string } | null>(null)

  const verify = async () => {
    setLoading(true)
    try {
      const response = await apiFetch<{ verified: boolean }>(`/api/evidence/${signature}?live=1`)
      setResult({
        verified: response.verified,
        message: response.verified
          ? '链上交易与本站存证协议、版本哈希和签名钱包完全一致。'
          : '当前未能完成实时链上核验；已确认凭证的本地状态不会因此被降级。',
      })
    } catch (error) {
      setResult({ verified: false, message: error instanceof Error ? error.message : '实时核验失败' })
    } finally {
      setLoading(false)
    }
  }

  return <div className="evidence-live-check">
    <Button type="primary" icon={<RefreshCw size={15} />} loading={loading} onClick={() => void verify()}>实时核验链上交易</Button>
    {result ? <Alert showIcon type={result.verified ? 'success' : 'warning'} icon={result.verified ? <ShieldCheck size={16} /> : undefined} message={result.verified ? '核验通过' : '暂未通过'} description={result.message} /> : null}
  </div>
}
