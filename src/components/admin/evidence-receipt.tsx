'use client'

/**
 * @file evidence-receipt.tsx
 * @project SlothVault
 * @module Administrator Evidence Receipt
 * @description Presents private test receipts and formal receipts inside the existing management shell.
 * @logic Reuse hash-only receipt data, label test evidence explicitly, and request live verification through the protected API.
 * @dependencies Ant Design, React Query, next-intl, evidence receipt API
 * @index_tags admin,evidence,receipt,verification,devnet
 * @author holic512
 */
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Alert, Button, Descriptions, Space, Tag, Typography } from 'antd'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api-client'
import type { getAdminEvidenceReceipt } from '@/server/services/evidence-receipts'
import { AdminPage } from './admin-page'

type Receipt = Awaited<ReturnType<typeof getAdminEvidenceReceipt>>

export function AdminEvidenceReceipt({ initial }: { initial: Receipt }) {
  const t = useTranslations('AdminEvidenceReceipt'), live = useTranslations('Evidence.live'), locale = useLocale()
  const [receipt, setReceipt] = useState(initial)
  const signature = receipt.evidence.transactionSignature!
  const network = receipt.evidence.network
  const verify = useMutation({
    mutationFn: () => apiFetch<Receipt>(`/api/admin/evidence/receipts/${receipt.kind}/${signature}?live=1`, { cache: 'no-store' }),
    onSuccess: setReceipt,
  })
  const date = (value: string | Date | null) => value ? new Date(value).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US') : t('unavailable')
  const code = (value: string | number | null) => value === null ? t('unavailable') : <Typography.Text code copyable style={{ overflowWrap: 'anywhere', wordBreak: 'break-all' }}>{String(value)}</Typography.Text>
  const e = receipt.evidence
  const fields = [
    { key: 'contentHash', label: t('contentHash'), children: code(e.contentHash) },
    { key: 'hash', label: t('hash'), children: code(e.subjectHash) },
    { key: 'subject', label: t('subject'), children: code(e.subjectId) },
    { key: 'signer', label: t('signer'), children: code(e.signerAddress) },
    { key: 'status', label: t('status'), children: e.status === 2 ? t('finalized') : t('pending') },
    { key: 'memo', label: 'Memo', children: code(e.memo) },
  ]
  const verification = receipt.verification
  return <AdminPage>
    <Space orientation="vertical" size="large" style={{ width: '100%', maxWidth: 960 }}>
      <div><Typography.Title level={2}>{t('title')}</Typography.Title><Tag color={network === 'devnet' ? 'warning' : 'success'}>{network === 'devnet' ? t('devnet') : t('mainnet')}</Tag></div>
      {network === 'devnet' ? <Alert showIcon type="warning" title={t('testNotice')} /> : null}
      <Descriptions bordered column={1} size="small" items={[
        ...fields,
        { key: 'signature', label: t('signature'), children: code(signature) },
        { key: 'blockTime', label: t('blockTime'), children: date(receipt.evidence.blockTime) },
      ]} />
      <Space wrap>
        <Button type="primary" icon={<RefreshCw size={15} />} loading={verify.isPending} onClick={() => verify.mutate()}>{live('action')}</Button>
        <Button href={`https://explorer.solana.com/tx/${encodeURIComponent(signature)}${network === 'devnet' ? '?cluster=devnet' : ''}`} target="_blank" rel="noreferrer" icon={<ExternalLink size={15} />}>Solana Explorer</Button>
      </Space>
      {verify.error ? <Alert showIcon type="error" title={live('failed')} description={verify.error.message} /> : null}
      {verification ? <Alert showIcon type={verification.verified ? 'success' : 'warning'} title={live(verification.verified ? 'passed' : 'notPassed')} description={'chainVerified' in verification ? <Space orientation="vertical"><span>{live('chain')} · {live(verification.chainVerified ? 'matched' : 'mismatched')}</span><span>{live('integrity')} · {live(verification.integrityVerified === null ? 'unavailable' : verification.integrityVerified ? 'matched' : 'mismatched')}</span></Space> : undefined} /> : null}
    </Space>
  </AdminPage>
}
