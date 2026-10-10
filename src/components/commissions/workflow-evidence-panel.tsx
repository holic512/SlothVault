'use client'
/**
 * @file workflow-evidence-panel.tsx
 * @project SlothVault
 * @module Workflow Evidence Actions
 * @description Signs and reconciles individual immutable commission submissions.
 * @logic Restrict Devnet to Phantom, bind signing to the prepared network, and retain signed bytes until submission or reconciliation resolves the outcome.
 * @dependencies wallet capability boundary, Ant Design, workflow evidence API, evidence-client
 * @index_tags commissions,evidence,wallet,retry,diagnostics
 * @author holic512
 */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, App, Button, Form, List, Modal, Select, Space, Tag } from 'antd'
import { useTranslations } from 'next-intl'
import { apiFetch, ApiClientError } from '@/lib/api-client'
import { EvidenceSubmissionCache, evidenceRequest } from '@/lib/evidence-client'
import { evidenceReason, EvidenceSigningError, type EvidenceNetwork, isExpiredEvidenceAttempt } from '@/lib/evidence-diagnostics'
import { useSolanaWallet } from '@/components/wallet/use-solana-wallet'
import type { WorkflowEvent } from '@/lib/commission-workflow'

type Prepared = { attemptId: string; transactionBase64: string; signerAddress: string; network: EvidenceNetwork; expiresAt: number; feeLamports: number; balanceLamports: number; memo: string; walletName: string | null }
type Result = { id: string; status: string; signature: string | null }
const labels: Record<string, string> = { PREPARED: '待钱包签名', SUBMITTED: '链上确认中', FINALIZED: '已存证', FAILED: '失败待重试', CANCELLED: '已取消签名' }

export function WorkflowEvidencePanel({ events, onUpdated }: { events: WorkflowEvent[]; onUpdated: () => void }) {
  const wallet = useSolanaWallet(), { message } = App.useApp()
  const t = useTranslations('AdminMM.evidenceManager')
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [form] = Form.useForm<{ network: EvidenceNetwork }>()
  const network = Form.useWatch('network', form)
  const signedCache = useRef(new EvidenceSubmissionCache())
  const [submissionUncertain, setSubmissionUncertain] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const devnetEligible = wallet.canSignForNetwork('devnet'), mainnetEligible = wallet.canSignForNetwork('mainnet')
  const networks = useQuery({ queryKey: ['contract-evidence-networks'], queryFn: () => apiFetch<{ networks: Array<{ network: EvidenceNetwork; enabled: boolean }> }>('/api/admin/contracts/evidence/networks') })
  const call = <T,>(body: object, phase: string, attemptId?: string) => evidenceRequest<T>('/api/admin/commissions/evidence', body, { attemptId, network: prepared?.network ?? network, walletName: wallet.walletName }, `commission.${phase}`)
  const errorMessage = (error: unknown) => {
    const keys = { EVIDENCE_PHANTOM_REQUIRED: 'phantomRequired', EVIDENCE_WALLET_UNSUPPORTED: 'walletUnsupported', EVIDENCE_WALLET_CHANGED: 'walletChanged',
      EVIDENCE_MESSAGE_MISMATCH: 'messageMismatch', EVIDENCE_SIGNATURE_INVALID: 'signatureInvalid', EVIDENCE_TRANSACTION_INVALID: 'transactionInvalid', EVIDENCE_STRUCTURE_INVALID: 'transactionInvalid',
      EVIDENCE_PREPARE_EXPIRED: 'expired', EVIDENCE_ATTEMPT_STALE: 'attemptStale', EVIDENCE_ATTEMPT_FAILED: 'attemptFailed', EVIDENCE_WALLET_SIGNATURE_REJECTED: 'signatureRejected',
      CHAIN_COMPUTE_BUDGET_EXCEEDED: 'computeBudgetExceeded', EVIDENCE_BALANCE_INSUFFICIENT: 'balanceInsufficient', CHAIN_SUBMISSION_FAILED: 'chainFailed', CHAIN_BLOCKHASH_UNAVAILABLE: 'submissionUnknown' } as const
    const reason = evidenceReason(error)
    return reason in keys ? t(`messages.${keys[reason as keyof typeof keys]}`) : t('messages.failure')
  }
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    const selected = form.getFieldValue('network')
    if (!prepared && ((selected === 'devnet' && !devnetEligible) || (selected === 'mainnet' && !mainnetEligible))) form.setFieldValue('network', undefined)
  }, [form, prepared, devnetEligible, mainnetEligible])
  const prepare = useMutation({
    mutationFn: async (eventId: string) => {
      if (!network || prepared || signedCache.current.pending) throw new EvidenceSigningError('EVIDENCE_WALLET_UNSUPPORTED')
      wallet.assertEvidenceNetwork(network)
      const walletName = wallet.walletName
      const result = await call<Prepared>({ action: 'prepare', eventId, network, signerAddress: wallet.address }, 'prepare')
      return { ...result, walletName }
    },
    onSuccess: (result) => { setPrepared(result); onUpdated() }, onError: (error) => message.error(errorMessage(error)),
  })
  const reconcile = useMutation({
    mutationFn: (attemptId: string) => call<Result>({ action: 'reconcile', attemptId: Number(attemptId) }, 'reconcile', attemptId),
    onSuccess: (result) => {
      if (result.id === prepared?.attemptId && ['SUBMITTED', 'FINALIZED', 'FAILED', 'CANCELLED'].includes(result.status)) { signedCache.current.clear(); setPrepared(null); setSubmissionUncertain(false) }
      onUpdated()
    }, onError: (error) => message.error(errorMessage(error)),
  })
  const submit = useMutation({
    mutationFn: async (value: Prepared) => {
      if (wallet.address !== value.signerAddress || (!signedCache.current.pending && wallet.walletName !== value.walletName)) throw new EvidenceSigningError('EVIDENCE_WALLET_CHANGED')
      wallet.assertEvidenceNetwork(value.network)
      const signed = await signedCache.current.payload(value.attemptId, async () => {
        try {
          if (isExpiredEvidenceAttempt({ status: 'PREPARED', expiresAt: value.expiresAt })) throw new EvidenceSigningError('EVIDENCE_PREPARE_EXPIRED')
          return await wallet.signPreparedTransaction(value.transactionBase64, value.network, value.attemptId)
        } catch (error) {
          await call({ action: 'cancel', attemptId: Number(value.attemptId) }, 'cancel', value.attemptId).catch(() => undefined)
          setPrepared(null); onUpdated(); throw error
        }
      })
      return call<Result>({ action: 'submit', attemptId: Number(value.attemptId), signedTransactionBase64: signed }, 'submit', value.attemptId)
    },
    onSuccess: (result) => {
      signedCache.current.clear(); setPrepared(null); setSubmissionUncertain(false)
      if (result.status === 'FINALIZED') message.success(t('messages.finalized'))
      else if (result.status === 'FAILED') message.error(t('messages.chainFailed'))
      else message.success(t('messages.submitted'))
      onUpdated()
    },
    onError: (error) => { if (signedCache.current.settleError(error)) setPrepared(null); setSubmissionUncertain(signedCache.current.pending); message.error(errorMessage(error)); onUpdated() },
  })
  return <section><h3>待办理的链上存证</h3><Alert type="info" title="每次正式提交对应一份独立存证" description="内容已冻结；钱包签名和链上确认完成后，才能独立核验链上摘要。正文与文件内容不会公开。" />
    {wallet.walletName && wallet.walletName !== 'Phantom' ? <Alert showIcon type="warning" title={t('messages.phantomRequired')} /> : null}
    <Space wrap style={{ margin: '16px 0' }}>
      <Form form={form} initialValues={{ network: devnetEligible ? 'devnet' : undefined }}>
        <Form.Item name="network" style={{ marginBottom: 0 }}><Select disabled={Boolean(prepared)} placeholder={t('drawer.network')} options={networks.data?.networks.map((item) => ({ value: item.network, disabled: !item.enabled || !wallet.canSignForNetwork(item.network), label: item.network === 'mainnet' ? '主网' : 'Devnet 测试网络' }))} /></Form.Item>
      </Form>
      <Button onClick={wallet.openWalletSelector}>{wallet.address ? '更换存证钱包' : '连接存证钱包'}</Button>
    </Space>
    {networks.error ? <Alert type="error" title={t('messages.loadFailed')} /> : null}
    <List dataSource={events} locale={{ emptyText: '正式提交后将出现待存证记录' }} renderItem={(event) => {
      const proof = event.proofs.find((item) => item.network === network)
      const expired = proof?.expiresAt && isExpiredEvidenceAttempt({ status: proof.status, expiresAt: proof.expiresAt }, now)
      const failure = proof?.error && /^[A-Z][A-Z0-9_]+$/.test(proof.error) ? errorMessage(new ApiClientError('Evidence failed', 400, 400, { reason: proof.error })) : proof?.error
      return <List.Item actions={proof?.status === 'FINALIZED' ? [<a key="verify" href={`/commission-evidence/${proof.signature}`} target="_blank" rel="noreferrer">核验凭证</a>] : [<Button key="prepare" loading={prepare.isPending} disabled={!network || !wallet.canSignForNetwork(network) || Boolean(prepared) || submissionUncertain || proof?.status === 'SUBMITTED' || !networks.data?.networks.some((item) => item.network === network && item.enabled)} onClick={() => prepare.mutate(event.id)}>准备存证</Button>, ...(proof ? [<Button key="refresh" loading={reconcile.isPending} onClick={() => reconcile.mutate(proof.id)}>核对状态</Button>] : [])]}><List.Item.Meta title={event.snapshot.note.slice(0, 90) || '系统记录'} description={<><Tag>{expired ? t('status.expired') : proof ? labels[proof.status] : '已冻结，待上链'}</Tag>{failure}</>} /></List.Item>
    }} />
    <Modal title="确认存证交易" open={Boolean(prepared)} okText={t(submissionUncertain ? 'actions.retrySubmission' : 'actions.sign')} cancelText="返回" confirmLoading={submit.isPending} okButtonProps={{ disabled: !prepared || wallet.address !== prepared.signerAddress || !wallet.canSignForNetwork(prepared.network) }} onOk={() => prepared && submit.mutate(prepared)} onCancel={() => {
      if (submit.isPending || !prepared) return
      if (signedCache.current.pending) { message.warning(t('messages.submissionUnknown')); return }
      void call({ action: 'cancel', attemptId: Number(prepared.attemptId) }, 'cancel', prepared.attemptId).catch(() => message.error(t('messages.cancelPending'))).finally(onUpdated)
      setPrepared(null)
    }}>
      {submissionUncertain && prepared ? <Alert showIcon type="warning" title={t('messages.submissionUnknown')} action={<Button onClick={() => reconcile.mutate(prepared.attemptId)} loading={reconcile.isPending}>{t('actions.reconcile')}</Button>} /> : null}
      {prepared ? <><p>网络：{prepared.network}</p><p>预计手续费：{prepared.feeLamports / 1e9} SOL</p><p>钱包余额：{prepared.balanceLamports / 1e9} SOL</p><details><summary>查看将上链的摘要</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{prepared.memo}</pre></details></> : null}
    </Modal>
  </section>
}
