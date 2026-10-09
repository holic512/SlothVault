'use client'
/**
 * @file public-evidence.tsx
 * @project SlothVault
 * @module Public Commission Verification
 * @description Displays public receipt verification without exposing private content.
 * @logic Fetch the signature-specific verification result and separate validity from record availability.
 * @dependencies React Query, commission evidence API
 * @index_tags commissions,workflow,access
 * @author holic512
 */
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Descriptions, Typography } from 'antd'
import { apiFetch } from '@/lib/api-client'
type Evidence = { verified: boolean; result: string; snapshotHash: string; previousHash: string | null; network: string; signer: string; signature: string; submittedAt: string; blockTime: string | null }
export function CommissionPublicEvidence({ signature }: { signature: string }) {
  const query = useQuery({ queryKey: ['commission-public-evidence', signature], queryFn: () => apiFetch<Evidence>(`/api/commission-evidence/${signature}`), retry: false })
  return <main className="container"><Card style={{ maxWidth: 900, margin: '40px auto', overflowWrap: 'anywhere' }}><Typography.Title level={2}>委托存证核验</Typography.Title><Typography.Paragraph>核验链上交易与提交摘要。合同、文件和用户资料仅向所属委托的参与者提供。</Typography.Paragraph>
    {query.error ? <Alert type="error" title={query.error.message} /> : null}
    {query.data ? <><Alert type={query.data.verified ? 'success' : 'warning'} title={query.data.result} /><Descriptions column={1} items={Object.entries({ 网络: query.data.network, 事件摘要: query.data.snapshotHash, 前序摘要: query.data.previousHash || '首条记录', 签名钱包: query.data.signer, 交易签名: query.data.signature, 业务提交时间: query.data.submittedAt, 链上确认时间: query.data.blockTime || '尚未确认' }).map(([label, value]) => ({ key: label, label, children: value }))} /></> : null}
    <Button loading={query.isFetching} onClick={() => void query.refetch()}>重新核验</Button>
  </Card></main>
}
