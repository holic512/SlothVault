'use client'
/**
 * @file document-dialog.tsx
 * @project SlothVault
 * @module Commission Document Review
 * @description Displays the authoritative document with explicit provider and customer confirmation.
 * @logic Show the immutable body before signing, keep verification details expandable, and print the document without workspace chrome.
 * @dependencies Ant Design, MarkdownView, private contract endpoints
 * @index_tags commissions,contracts,review,signature,print
 * @author holic512
 */
import { useState } from 'react'
import { Alert, Button, Checkbox, Drawer, Input, Space, Typography } from 'antd'
import { MarkdownView } from '@/components/markdown/markdown-view'
import type { CommissionDocumentDto } from '@/types/commissions'
export function CommissionDocumentDialog({ document, commissionBase, admin, busy, onClose, onAction }: { document: CommissionDocumentDto | null; commissionBase: string; admin: boolean; busy: boolean; onClose: () => void; onAction: (id: string, action: 'sign' | 'decline' | 'issue' | 'cancel', reason?: string) => void }) {
  const [acknowledged, setAcknowledged] = useState(false), [reason, setReason] = useState('')
  const print = () => { window.document.body.setAttribute('data-commission-print', 'true'); window.addEventListener('afterprint', () => window.document.body.removeAttribute('data-commission-print'), { once: true }); window.print() }
  return <Drawer open={Boolean(document)} title={document?.title} size={900} onClose={() => { setAcknowledged(false); setReason(''); onClose() }} className="commission-document-drawer">
    {document ? <>
      <div className="commission-document-paper"><MarkdownView content={document.body} />{document.associatedFiles.length ? <div><h3>本次确认的关联资料</h3>{document.associatedFiles.map((f) => <p key={f.id}><a href={`${commissionBase}/files/${f.id}`}>{f.originalName}</a>（{f.fileSize} 字节）<br />SHA-256：{f.sha256}</p>)}</div> : null}<div className="commission-signatures"><p>开发方确认账户：{document.providerAccount}；时间：{document.issuedAt ? new Date(document.issuedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '尚未发起'}</p><p>客户确认账户：{document.customerAccount}；时间：{document.signedAt ? new Date(document.signedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '尚未签署'}</p></div></div>
      <details className="commission-verification"><summary>查看文件校验信息</summary><Typography.Paragraph copyable>{document.bodyHash}</Typography.Paragraph><Typography.Paragraph copyable>{document.contractHash || '客户签署后生成完整校验值'}</Typography.Paragraph></details>
      <Space className="commission-document-actions" wrap><Button onClick={print}>打印</Button><Button href={`/api/${admin ? 'admin' : 'account'}/contracts/${document.id}/download`} target="_blank">下载 Markdown</Button>{document.attachment ? <Button href={`/api/${admin ? 'admin' : 'account'}/contracts/${document.id}/attachment`} target="_blank">下载 PDF 附件</Button> : null}</Space>
      {document.status === 0 && admin ? <div className="commission-document-actions"><Alert type="info" title="正式发起前核对正文与附件一" description="发起即记录开发方确认并冻结本文件，之后由客户本人阅读、签署。" /><Checkbox checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)}>我代表开发方确认本文件内容</Checkbox><Button type="primary" loading={busy} disabled={!acknowledged} onClick={() => onAction(document.id, 'issue')}>确认并发起签署</Button></div> : null}
      {document.status === 1 && !admin ? <div className="commission-document-actions"><Alert type="warning" title="请核对开发范围、费用、交付与权利约定" description="签署后保存您的确认记录；需要修改时请先提出异议。" /><Checkbox checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)}>我已阅读正文及关联附件，同意内容并确认签署</Checkbox><Button type="primary" loading={busy} disabled={!acknowledged} onClick={() => onAction(document.id, 'sign')}>确认签署</Button><Input.TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如需拒绝确认，请说明需要调整的内容" rows={2} maxLength={500} /><Button danger disabled={busy || !reason.trim()} onClick={() => onAction(document.id, 'decline', reason)}>拒绝确认并反馈原因</Button></div> : null}
      {document.status === 2 ? <Alert type="success" title="双方已完成在线确认" /> : null}
      {document.status === -1 ? <Alert type="warning" title="客户已拒绝确认" description={document.declineReason} /> : null}
      {admin && [0, 1].includes(document.status) ? <Button danger disabled={busy} onClick={() => onAction(document.id, 'cancel')}>取消此文件</Button> : null}
    </> : null}
  </Drawer>
}
