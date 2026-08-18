/**
 * @file page.tsx
 * @project SlothVault
 * @module Public Contract Evidence Receipt
 * @description Renders a public hash-only receipt for one contract chain transaction without exposing private contract material or party identity.
 * @logic Resolve the stored credential by Solana signature, present only deterministic evidence fields, and offer live verification plus explorer access.
 * @dependencies contract service, PublicContractEvidenceVerifier, PublicNavbar, Ant Design
 * @index_tags public,contracts,evidence,receipt,verification,privacy,solana
 * @author holic512
 */
import { Alert, Tag, Typography } from 'antd'
import { BadgeCheck, ExternalLink, FileKey2, FlaskConical, ShieldCheck } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { PublicContractEvidenceVerifier } from '@/components/evidence/public-contract-evidence-verifier'
import { PublicNavbar } from '@/components/shell/public-navbar'
import { createPageMetadata } from '@/i18n/metadata'
import { getSystemBranding } from '@/server/services/system-branding'
import { getPublicContractEvidence } from '@/server/services/contracts'
import evidenceStyles from '@/styles/modules/evidence.module.css'

export const dynamic = 'force-dynamic'

function explorerUrl(signature: string, network: string) {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${network === 'devnet' ? '?cluster=devnet' : ''}`
}

export async function generateMetadata({ params }: { params: Promise<{ transactionSignature: string }> }): Promise<Metadata> {
  const { transactionSignature } = await params
  return createPageMetadata('contractEvidenceReceipt', { signature: `${transactionSignature.slice(0, 8)}…` })
}

export default async function ContractEvidenceReceiptPage({ params }: { params: Promise<{ transactionSignature: string }> }) {
  const { transactionSignature } = await params
  const evidence = await getPublicContractEvidence(transactionSignature)
  if (!evidence) notFound()
  const finalized = evidence.status === 2
  return <div className={evidenceStyles.root}>
    <PublicNavbar branding={await getSystemBranding()} />
    <main className="evidence-receipt-shell">
      <header className="evidence-receipt-header">
        <span className="evidence-receipt-seal">{evidence.network === 'devnet' ? <FlaskConical /> : <ShieldCheck />}</span>
        <div><p>SLOTHVAULT · CONTRACT EVIDENCE</p><h1>合同防篡改凭证</h1><span>公开页仅提供哈希级核验，不含合同正文、PDF 或签约身份。</span></div>
        <Tag color={evidence.network === 'devnet' ? 'warning' : 'success'}>{evidence.network === 'devnet' ? 'DEVNET · 测试凭证' : 'MAINNET · 链上存证'}</Tag>
      </header>
      {evidence.network === 'devnet' ? <Alert showIcon type="warning" message="这是 Devnet 测试凭证，不应作为长期正式链上记录。" /> : null}
      <section className="evidence-receipt-paper">
        <div className="evidence-receipt-title"><span>核验范围</span><strong>{finalized ? '合同冻结摘要已写入链上' : '合同链上凭证处理中'}</strong></div>
        <dl>
          <div><dt><BadgeCheck size={16} />凭证编号</dt><dd><code>{evidence.id}</code></dd></div>
          <div><dt><FileKey2 size={16} />合同摘要哈希</dt><dd><code>{evidence.contractHash || '签约摘要不可用'}</code></dd></div>
          <div><dt><BadgeCheck size={16} />交易签名</dt><dd><code>{evidence.transactionSignature}</code></dd></div>
          <div><dt><BadgeCheck size={16} />链上状态</dt><dd>{finalized ? '已最终确认' : '等待最终确认或需对账'}</dd></div>
          <div><dt><BadgeCheck size={16} />链上时间</dt><dd>{evidence.blockTime ? new Date(evidence.blockTime).toLocaleString() : '尚未最终确认'}</dd></div>
          <div><dt><BadgeCheck size={16} />最终核验时间</dt><dd>{evidence.lastVerifiedAt ? new Date(evidence.lastVerifiedAt).toLocaleString() : '尚未核验'}</dd></div>
        </dl>
        <div className="evidence-receipt-actions">
          <PublicContractEvidenceVerifier signature={transactionSignature} />
          <a href={explorerUrl(transactionSignature, evidence.network)} target="_blank" rel="noreferrer">Solana Explorer <ExternalLink size={14} /></a>
        </div>
      </section>
      <Typography.Paragraph className="evidence-receipt-disclaimer">本凭证证明 SlothVault 在对应链上交易中提交了此合同快照摘要。它是防篡改技术存证，不构成法定电子签名、司法公证或第三方电子签约证明。</Typography.Paragraph>
    </main>
  </div>
}
