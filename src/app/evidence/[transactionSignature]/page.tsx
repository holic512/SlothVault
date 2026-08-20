/**
 * @file page.tsx
 * @project SlothVault
 * @module Public Evidence Receipt
 * @description Renders a durable public receipt for a legacy release or exact note-content transaction signature.
 * @logic Dispatch labels and downloads by subject type, redact non-public note revision metadata, and preserve live-chain verification and explorer access.
 * @dependencies release evidence service, public evidence verifier, Ant Design
 * @index_tags public,evidence,receipt,verification,solana
 * @author holic512
 */
import { Alert, Tag } from 'antd'
import { BadgeCheck, Download, ExternalLink, FileKey2, FlaskConical, Fingerprint, WalletCards } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PublicEvidenceVerifier } from '@/components/evidence/public-evidence-verifier'
import { PublicNavbar } from '@/components/shell/public-navbar'
import { createPageMetadata } from '@/i18n/metadata'
import { getPublicReleaseEvidence } from '@/server/services/release-evidence'
import { getSystemBranding } from '@/server/services/system-branding'
import evidenceStyles from '@/styles/modules/evidence.module.css'

export const dynamic = 'force-dynamic'

function explorerUrl(signature: string, network: string) {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${network === 'devnet' ? '?cluster=devnet' : ''}`
}

export async function generateMetadata({ params }: { params: Promise<{ transactionSignature: string }> }): Promise<Metadata> {
  const { transactionSignature } = await params
  return createPageMetadata('evidenceReceipt', { signature: `${transactionSignature.slice(0, 8)}…` })
}

export default async function EvidenceReceiptPage({ params }: { params: Promise<{ transactionSignature: string }> }) {
  const { transactionSignature } = await params
  const evidence = await getPublicReleaseEvidence(transactionSignature)
  if (!evidence) notFound()
  const isNoteContent = evidence.subjectType === 'NOTE_CONTENT'

  return <div className={evidenceStyles.root}>
    <PublicNavbar branding={await getSystemBranding()} />
    <main className="evidence-receipt-shell">
      <header className="evidence-receipt-header">
        <span className="evidence-receipt-seal">{evidence.network === 'devnet' ? <FlaskConical /> : <BadgeCheck />}</span>
        <div>
          <p>SLOTHVAULT · {isNoteContent ? 'NOTE CONTENT EVIDENCE' : 'RELEASE EVIDENCE'}</p>
          <h1>{isNoteContent ? (evidence.network === 'devnet' ? '笔记内容测试存证' : '笔记内容版本存证') : (evidence.network === 'devnet' ? '版本测试存证' : '版本交易存证')}</h1>
          <span>公开编号由 Solana 交易签名唯一确定</span>
        </div>
        <Tag color={evidence.network === 'devnet' ? 'warning' : 'success'}>{evidence.network === 'devnet' ? 'DEVNET · 测试凭证' : 'MAINNET · 正式存证'}</Tag>
      </header>

      {evidence.network === 'devnet' ? <Alert showIcon type="warning" message="这是 Devnet 测试凭证，不具备 Mainnet 正式存证标识。" /> : null}
      {!evidence.subjectVisible ? <Alert showIcon type="info" message={isNoteContent ? '来源内容当前不公开' : '来源版本当前不可见'} description={isNoteContent ? '该凭证绑定的内容不是当前公开、启用的主版本；仅展示不可逆标识、哈希和链上信息。' : '仍展示已经公开写入链上的字段；项目正文、版本名称和 manifest 下载已隐藏。'} /> : null}

      <section className="evidence-receipt-paper">
        {evidence.subjectVisible ? <div className="evidence-receipt-title"><span>{isNoteContent ? '来源内容' : '来源版本'}</span><strong>{isNoteContent ? `${evidence.projectName} / ${evidence.version} / ${evidence.categoryName} / ${evidence.noteTitle} / ${evidence.contentVersion || '未命名版本'}` : `${evidence.projectName} / ${evidence.version}`}</strong></div> : null}
        <dl>
          <div><dt><Fingerprint size={16} />{isNoteContent ? '内容版本哈希' : '整版发布哈希'}</dt><dd><code>{evidence.subjectHash}</code></dd></div>
          <div><dt>稳定对象标识</dt><dd><code>{evidence.subjectId}</code></dd></div>
          <div><dt><WalletCards size={16} />签名钱包</dt><dd><code>{evidence.signerAddress}</code></dd></div>
          <div><dt><FileKey2 size={16} />交易签名</dt><dd><code>{evidence.transactionSignature}</code></dd></div>
          <div><dt>网络</dt><dd>{evidence.network === 'mainnet' ? 'Solana Mainnet' : 'Solana Devnet（测试）'}</dd></div>
          <div><dt>区块位置</dt><dd>{evidence.slot || '待确认'}</dd></div>
          <div><dt>区块时间</dt><dd>{evidence.blockTime ? new Date(evidence.blockTime).toLocaleString('zh-CN') : '待确认'}</dd></div>
          <div><dt>交易费用</dt><dd>{evidence.feeLamports ? `${evidence.feeLamports} lamports` : '待确认'}</dd></div>
          <div><dt>协议 Memo</dt><dd><code>{evidence.memo}</code></dd></div>
        </dl>
        <div className="evidence-receipt-actions">
          {evidence.subjectVisible ? <a href={isNoteContent ? `/api/evidence/${transactionSignature}/manifest` : `/api/project/${evidence.projectId}/v/${evidence.projectVersionId}/manifest`} download>下载 Manifest <Download size={14} /></a> : null}
          <a href={explorerUrl(transactionSignature, evidence.network)} target="_blank" rel="noreferrer">Solana Explorer <ExternalLink size={14} /></a>
          {evidence.subjectVisible ? <Link href={isNoteContent ? `/project/${evidence.projectId}/v/${evidence.projectVersionId}/docs/${evidence.noteId}` : `/project/${evidence.projectId}/v/${evidence.projectVersionId}/docs`}>{isNoteContent ? '查看正文' : '查看版本'}</Link> : null}
        </div>
      </section>
      <PublicEvidenceVerifier signature={transactionSignature} />
      <p className="evidence-receipt-disclaimer">本凭证仅证明所示钱包签署了包含该{isNoteContent ? '内容版本' : '发布版本'}哈希的交易，不表示 NFT 所有权、版权归属、接收人身份或可转移资产。</p>
    </main>
  </div>
}
