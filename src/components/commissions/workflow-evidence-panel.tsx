'use client'
/**
 * @file workflow-evidence-panel.tsx
 * @project SlothVault
 * @module Workflow Evidence Actions
 * @description Signs and reconciles individual immutable commission submissions.
 * @logic Display network and fee before asking the connected wallet to sign an exact prepared transaction.
 * @dependencies wallet capability boundary, Ant Design, workflow evidence API
 * @index_tags commissions,evidence,wallet
 * @author holic512
 */
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, App, Button, List, Modal, Select, Space, Tag } from 'antd'
import { apiFetch } from '@/lib/api-client'
import { useSolanaWallet } from '@/components/wallet/use-solana-wallet'
import type { WorkflowEvent } from '@/lib/commission-workflow'
type Prepared = { attemptId: string; transactionBase64: string; signerAddress: string; network: string; feeLamports: number; balanceLamports: number; memo: string }
const labels: Record<string, string> = { PREPARED: '待钱包签名', SUBMITTED: '链上确认中', FINALIZED: '已存证', FAILED: '失败待重试', CANCELLED: '已取消签名' }
export function WorkflowEvidencePanel({ events, onUpdated }: { events: WorkflowEvent[]; onUpdated: () => void }) {
  const wallet = useSolanaWallet(), { message } = App.useApp()
  const [network, setNetwork] = useState('devnet'), [prepared, setPrepared] = useState<Prepared | null>(null)
  const networks = useQuery({ queryKey: ['contract-evidence-networks'], queryFn: () => apiFetch<{ networks: Array<{ network: string; enabled: boolean }> }>('/api/admin/contracts/evidence/networks') })
  const call = <T,>(body: object) => apiFetch<T>('/api/admin/commissions/evidence', { method: 'POST', body: JSON.stringify(body) })
  const prepare = useMutation({ mutationFn: (eventId: string) => call<Prepared>({ action: 'prepare', eventId, network, signerAddress: wallet.address }), onSuccess: setPrepared, onError: (error) => message.error(error.message) })
  const reconcile = useMutation({ mutationFn: (attemptId: string) => call({ action: 'reconcile', attemptId: Number(attemptId) }), onSuccess: onUpdated, onError: (error) => message.error(error.message) })
  const submit = useMutation({ mutationFn: async (value: Prepared) => {
    if (wallet.address !== value.signerAddress || !wallet.canSignTransaction) throw new Error('请连接准备交易时的钱包')
    let signed: string
    try { signed = await wallet.signPreparedTransaction(value.transactionBase64) }
    catch (error) { await call({ action: 'cancel', attemptId: Number(value.attemptId) }).catch(() => undefined); setPrepared(null); onUpdated(); throw error }
    return call({ action: 'submit', attemptId: Number(value.attemptId), signedTransactionBase64: signed })
  }, onSuccess: () => { setPrepared(null); message.success('签名交易已保存，正在确认链上结果'); onUpdated() }, onError: (error) => message.error(error.message) })
  return <section><h3>待办理的链上存证</h3><Alert type="info" title="每次正式提交对应一份独立存证" description="内容已冻结；钱包签名和链上确认完成后，才能独立核验链上摘要。正文与文件内容不会公开。" />
    <Space wrap style={{ margin: '16px 0' }}><Select value={network} onChange={setNetwork} options={networks.data?.networks.filter((item) => item.enabled).map((item) => ({ value: item.network, label: item.network === 'mainnet' ? '主网' : 'Devnet 测试网络' }))} /><Button onClick={wallet.openWalletSelector}>{wallet.address ? '更换存证钱包' : '连接存证钱包'}</Button></Space>
    {networks.error ? <Alert type="error" title={networks.error.message} /> : null}
    <List dataSource={events} locale={{ emptyText: '正式提交后将出现待存证记录' }} renderItem={(event) => {
      const proof = event.proofs.find((item) => item.network === network)
      return <List.Item actions={proof?.status === 'FINALIZED' ? [<a key="verify" href={`/commission-evidence/${proof.signature}`} target="_blank" rel="noreferrer">核验凭证</a>] : [<Button key="prepare" loading={prepare.isPending} disabled={!wallet.address || proof?.status === 'SUBMITTED' || !networks.data?.networks.some((item) => item.network === network && item.enabled)} onClick={() => prepare.mutate(event.id)}>准备存证</Button>, ...(proof ? [<Button key="refresh" loading={reconcile.isPending} onClick={() => reconcile.mutate(proof.id)}>核对状态</Button>] : [])]}><List.Item.Meta title={event.snapshot.note.slice(0, 90) || '系统记录'} description={<><Tag>{proof ? labels[proof.status] : '已冻结，待上链'}</Tag>{proof?.error}</>} /></List.Item>
    }} />
    <Modal title="确认存证交易" open={Boolean(prepared)} okText="请求钱包签名" cancelText="返回" confirmLoading={submit.isPending} onOk={() => prepared && submit.mutate(prepared)} onCancel={() => { if (!submit.isPending && prepared) { void call({ action: 'cancel', attemptId: Number(prepared.attemptId) }).catch((error: Error) => message.error(error.message)).finally(onUpdated); setPrepared(null) } }}>
      {prepared ? <><p>网络：{prepared.network}</p><p>预计手续费：{prepared.feeLamports / 1e9} SOL</p><p>钱包余额：{prepared.balanceLamports / 1e9} SOL</p><details><summary>查看将上链的摘要</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{prepared.memo}</pre></details></> : null}
    </Modal>
  </section>
}
