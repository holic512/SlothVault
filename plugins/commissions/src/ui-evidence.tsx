/**
 * @file ui-evidence.tsx
 * @project SlothVault
 * @module Commission evidence controls
 * @description In-place, administrator-only mainnet evidence with fee review and recoverable signing.
 * @logic Prepare before signing, reuse signed bytes on transport failure, reconcile broadcasts before retry, never optimistically advance a stage.
 * @dependencies React, plugin client SDK, commissions DTOs
 * @index_tags commissions,evidence,wallet,mainnet
 * @author holic512
 */
import { useRef, useState } from 'react'
import { Alert, Button, Descriptions, Space, Typography, usePluginWallet, useQueryClient } from '@slothvault/plugin-sdk/client'
import { API, type CommissionDetail, type CommandResult, type EvidenceAttempt, type FrozenAction } from './domain'
import { errorText } from './presentation'
import { ErrorNotice, Status, kindNames, post, publicUrl, queryRoot, useDate } from './ui'
type EvidencePanelProps = { detail: CommissionDetail; record: FrozenAction; admin: boolean; onWithdraw?: () => void }
export function EvidencePanel(props: EvidencePanelProps) {
  return props.admin ? <WalletEvidencePanel {...props} /> : <EvidenceContent {...props} wallet={null} />
}
function WalletEvidencePanel(props: EvidencePanelProps) {
  const wallet = usePluginWallet()
  return <EvidenceContent {...props} wallet={wallet} />
}
function EvidenceContent({ detail, record, admin, onWithdraw, wallet }: EvidencePanelProps & { wallet: ReturnType<typeof usePluginWallet> | null }) {
  const cache = useQueryClient(), date = useDate()
  const [attempt, setAttempt] = useState<EvidenceAttempt | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null)
  const [hasSigned, setHasSigned] = useState(false)
  const signed = useRef<{ attemptId: string; bytes: string; commandId: string } | null>(null), ids = useRef(new Map<string, string>()), lock = useRef(false)
  const idFor = (key: string) => { const id = ids.current.get(key) ?? crypto.randomUUID(); ids.current.set(key, id); return id }
  const update = async (result: { detail: CommissionDetail }) => { cache.setQueryData([...queryRoot, 'detail', detail.commission.id], result.detail); await cache.invalidateQueries({ queryKey: queryRoot }) }
  const execute = async (operation: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try { await operation() } catch (cause) { setError(cause); await cache.invalidateQueries({ queryKey: queryRoot }) } finally { lock.current = false; setBusy(false) }
  }
  const reconcile = () => execute(async () => {
    await update(await post<CommandResult>(API.reconcile, { commissionId: detail.commission.id, evidenceId: record.id, revision: detail.commission.revision, commandId: crypto.randomUUID() }))
  })
  const prepare = () => execute(async () => {
    if (!wallet) return
    const { address } = await wallet.requestConnection()
    const result = await post<{ detail: CommissionDetail; attempt: EvidenceAttempt }>(API.prepare, { commissionId: detail.commission.id, evidenceId: record.id, revision: detail.commission.revision, commandId: idFor(`prepare:${detail.commission.revision}:${address}`), signerAddress: address })
    setAttempt(result.attempt); signed.current = null; setHasSigned(false); await update(result)
  })
  const sign = () => execute(async () => {
    if (!attempt || !wallet) return
    if (wallet.address !== attempt.prepared.signerAddress) await wallet.requestConnection({ expectedAddress: attempt.prepared.signerAddress })
    if (!signed.current || signed.current.attemptId !== attempt.id) {
      const bytes = await wallet.signPreparedTransaction(attempt.prepared.transactionBase64, 'mainnet', attempt.id)
      signed.current = { attemptId: attempt.id, bytes, commandId: crypto.randomUUID() }; setHasSigned(true)
    }
    await update(await post<CommandResult>(API.submit, { commissionId: detail.commission.id, evidenceId: record.id, revision: detail.commission.revision, commandId: signed.current.commandId, attemptId: attempt.id, signedTransactionBase64: signed.current.bytes }))
  })
  const final = record.status === 'FINALIZED', submitted = record.status === 'SUBMITTED', withdrawn = record.status === 'WITHDRAWN'
  const canSign = attempt && record.attemptId === attempt.id && record.status === 'PREPARED'
  const insufficient = !!attempt && attempt.prepared.balanceLamports < attempt.prepared.feeLamports
  return <section className="commission-evidence" aria-label={`${kindNames[record.kind]}存证`}>
    <div className="commission-section-heading"><h3>{kindNames[record.kind]}存证</h3><Status value={record.status} evidence /></div>
    <p role="status">{final ? `已完成主网存证，生效时间：${date(record.effectiveAt)}。` : withdrawn ? '此记录已撤回，不会推动委托阶段。' : submitted ? '交易已提交，等待主网最终确认。确认前不会推进业务，请勿重复提交。' : admin ? '内容已冻结。管理员完成 Solana 主网存证后，本步骤才会生效。' : '内容已提交，等待管理员办理存证。你无需连接钱包或支付链上费用。'}</p>
    {admin && !final && !withdrawn && <>
      <ErrorNotice error={error} />
      {record.error && <Alert type="warning" title="上次存证尚未完成" description={errorText(record.error)} />}
      {canSign && <Descriptions size="small" column={1} items={[
        { key: 'network', label: '网络', children: 'Solana 主网（Mainnet）' },
        { key: 'wallet', label: '管理员钱包', children: <Typography.Text className="commission-break" copyable>{attempt.prepared.signerAddress}</Typography.Text> },
        { key: 'fee', label: '预计手续费', children: `${(attempt.prepared.feeLamports / 1e9).toFixed(9)} SOL` },
        { key: 'balance', label: '可用余额', children: `${(attempt.prepared.balanceLamports / 1e9).toFixed(9)} SOL` },
      ]} />}
      {insufficient && canSign && <Alert type="warning" showIcon title="钱包余额不足以支付手续费" description="请为此管理员钱包补足主网 SOL，再重新准备存证。已冻结内容会保留。" />}
      <Space wrap>
        {submitted ? <Button type="primary" loading={busy} onClick={reconcile}>核对链上状态</Button> : canSign && !insufficient ? <Button type="primary" loading={busy} onClick={sign}>{hasSigned ? '重试提交同一笔交易' : '签名并提交主网存证'}</Button> : <Button type="primary" loading={busy} onClick={prepare}>{wallet?.connected ? '准备主网存证' : '连接管理员钱包并准备存证'}</Button>}
        {canSign && !hasSigned && !insufficient && <Button disabled={busy} onClick={prepare}>重新准备</Button>}
        {record.signature && !submitted && !final && <Button disabled={busy} onClick={reconcile}>先核对原交易</Button>}
        {!submitted && !record.signature && !hasSigned && onWithdraw && <Button disabled={busy} onClick={onWithdraw}>撤回待生效记录</Button>}
      </Space>
    </>}
    <details className="commission-proof"><summary>查看摘要与公开核验</summary><dl><dt>内容摘要</dt><dd>{record.digest}</dd><dt>记录时间</dt><dd>{date(record.createdAt)}</dd>{record.signature && <><dt>主网交易</dt><dd><a href={`https://explorer.solana.com/tx/${encodeURIComponent(record.signature)}`} target="_blank" rel="noopener noreferrer">{record.signature}</a></dd></>}</dl><a href={publicUrl('receipt', { evidenceId: record.id })} target="_blank" rel="noopener noreferrer">打开公开核验回执（不含正文或附件）</a></details>
  </section>
}
