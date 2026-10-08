'use client'
/**
 * @file evidence-panel.tsx
 * @project SlothVault
 * @module Commission Evidence
 * @description Keeps optional chain evidence available for signed commission documents.
 * @logic Prepare a bounded transaction, display its fee, request the connected wallet's explicit signature, then reconcile the resulting receipt.
 * @dependencies Solana wallet capability boundary, contract evidence APIs
 * @index_tags commissions,evidence,wallet
 * @author holic512
 */
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, App, Button, Collapse, List, Modal, Select, Space } from 'antd'
import { apiFetch } from '@/lib/api-client'
import { useSolanaWallet } from '@/components/wallet/use-solana-wallet'
import type { CommissionDocumentDto } from '@/types/commissions'

type Prepared = { credentialId: string; attemptId: string; transactionBase64: string; signerAddress: string; network: 'mainnet' | 'devnet'; feeLamports: number; balanceLamports: number; expiresAt: number; memo: string }
export function CommissionEvidencePanel({ documents, onUpdated }: { documents: CommissionDocumentDto[]; onUpdated: () => void }) {
  const wallet = useSolanaWallet(), { message } = App.useApp()
  const [network, setNetwork] = useState<'mainnet' | 'devnet'>('devnet'), [prepared, setPrepared] = useState<Prepared | null>(null)
  const networks = useQuery({ queryKey: ['contract-evidence-networks'], queryFn: () => apiFetch<{ networks: Array<{ network: 'mainnet' | 'devnet'; enabled: boolean }> }>('/api/admin/contracts/evidence/networks') })
  const prepare = useMutation({ mutationFn: (id: string) => apiFetch<Prepared>('/api/admin/contracts/evidence/prepare', { method: 'POST', body: JSON.stringify({ contractId: Number(id), network, signerAddress: wallet.address }) }), onSuccess: setPrepared, onError: (e) => message.error(e.message) })
  const submit = useMutation({ mutationFn: async (p: Prepared) => {
    if (wallet.address !== p.signerAddress || !wallet.canSignTransaction) throw new Error('请连接准备交易时使用的钱包')
    let signedTransactionBase64: string
    try { signedTransactionBase64 = await wallet.signPreparedTransaction(p.transactionBase64) }
    catch (e) { await apiFetch(`/api/admin/contracts/evidence/attempts/${p.attemptId}/cancel`, { method: 'POST', body: JSON.stringify({ reason: '钱包未完成确认' }) }).catch(() => undefined); throw e }
    return apiFetch('/api/admin/contracts/evidence/submit', { method: 'POST', body: JSON.stringify({ attemptId: p.attemptId, signedTransactionBase64 }) })
  }, onSuccess: () => { setPrepared(null); message.success('存证交易已提交'); onUpdated() }, onError: (e) => message.error(e.message) })
  const reconcile = useMutation({ mutationFn: (id: string) => apiFetch(`/api/admin/contracts/evidence/${id}/reconcile`, { method: 'POST', body: '{}' }), onSuccess: onUpdated, onError: (e) => message.error(e.message) })
  return <><Collapse items={[{ key: 'evidence', label: '可选：文件链上存证与校验', children: <Space orientation="vertical" style={{ width: '100%' }}>
    <Alert type="info" title="在线确认后，可另行保存文件摘要的链上记录" description="存证交易需要钱包确认及网络手续费。文件正文和客户资料不会上传到链上。" />
    <Space wrap><Select value={network} onChange={setNetwork} options={(networks.data?.networks || []).filter((n) => n.enabled).map((n) => ({ value: n.network, label: n.network === 'mainnet' ? 'Mainnet' : 'Devnet 测试网络' }))} /><Button onClick={wallet.openWalletSelector}>{wallet.address ? '更换钱包' : '连接存证钱包'}</Button></Space>
    <List dataSource={documents.filter((d) => d.status === 2)} locale={{ emptyText: '双方完成签署后可办理存证' }} renderItem={(d) => <List.Item actions={[<Button key="prepare" disabled={!wallet.address || !networks.data?.networks.some((n) => n.network === network && n.enabled)} loading={prepare.isPending} onClick={() => prepare.mutate(d.id)}>准备存证</Button>]}><List.Item.Meta title={d.title} description={<Space wrap>{d.credentials.map((c) => c.status === 2 && c.transactionSignature ? <a key={c.id} href={`/contract-evidence/${c.transactionSignature}`} target="_blank" rel="noreferrer">查看 {c.network} 凭证</a> : <Button key={c.id} size="small" loading={reconcile.isPending} onClick={() => reconcile.mutate(c.id)}>核对 {c.network} 状态</Button>)}</Space>} /></List.Item>} />
  </Space> }]} />
    <Modal title="确认存证交易" open={Boolean(prepared)} confirmLoading={submit.isPending} onOk={() => prepared && submit.mutate(prepared)} okText="请求钱包签署并提交" onCancel={() => { if (!submit.isPending && prepared) { void apiFetch(`/api/admin/contracts/evidence/attempts/${prepared.attemptId}/cancel`, { method: 'POST', body: JSON.stringify({ reason: '管理员关闭存证确认' }) }).catch(() => undefined); setPrepared(null) } }}>
      {prepared ? <><p>网络：{prepared.network}；预计手续费：{prepared.feeLamports / 1e9} SOL</p><p>钱包余额：{prepared.balanceLamports / 1e9} SOL</p><details><summary>摘要内容</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{prepared.memo}</pre></details></> : null}
    </Modal></>
}
