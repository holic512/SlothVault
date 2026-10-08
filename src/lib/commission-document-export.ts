/**
 * @file commission-document-export.ts
 * @project SlothVault
 * @module Commission Document Export
 * @description Appends account confirmations and the frozen file manifest to an unchanged formal document.
 * @logic Preserve the body bytes, render Beijing timestamps, and export associated hashes separately from legal clauses.
 * @dependencies none
 * @index_tags commissions,contracts,export,confirmation,markdown
 * @author holic512
 */
type ExportDocument = {
  body: string; contractId: string; bodyHash: string; contractHash: string | null
  snapshotHash?: string | null; issuedAt: string | Date | null; signedAt: string | Date | null
  providerAccount: string; customerAccount: string
  associatedFiles: Array<{ originalName: string; fileSize: string; sha256: string }>
}
const timestamp = (value: string | Date | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + '（北京时间）' : '尚未确认'
const escaped = (value: string) => value.replace(/[\\`*_{}\[\]<>|\r\n]/g, (character) => /[\r\n]/.test(character) ? ' ' : '\\' + character)
export function commissionDocumentMarkdown(document: ExportDocument): string {
  const files = document.associatedFiles.map((f) => `- ${escaped(f.originalName)}：${f.fileSize} 字节；SHA-256：${f.sha256}`).join('\n')
  return `${document.body}\n\n---\n\n## 在线确认记录\n\n- 文件编号：${document.contractId}\n- 开发方确认账户：${escaped(document.providerAccount)}；时间：${timestamp(document.issuedAt)}\n- 客户确认账户：${escaped(document.customerAccount)}；时间：${timestamp(document.signedAt)}\n- 正文 SHA-256：${document.bodyHash}\n- 模板及资料快照 SHA-256：${document.snapshotHash || '无'}\n- 完整文件校验：${document.contractHash || '客户签署后生成'}\n\n## 本次确认的关联资料\n\n${files || '未关联额外资料'}\n`
}
