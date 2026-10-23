/**
 * @file receipt-page.tsx
 * @project SlothVault
 * @module Public commission receipt
 * @description Privacy-minimized public evidence verification with digest and mainnet transaction only.
 * @logic Render only the explicit public DTO and never request private commission detail or files.
 * @dependencies Plugin client SDK, commissions DTOs
 * @index_tags commissions,receipt,privacy,mainnet
 * @author holic512
 */
import { Alert, Button, Descriptions, PluginPage, Typography, useQuery } from '@slothvault/plugin-sdk/client'
import { API, type PublicReceipt } from './domain'
import { ErrorNotice, Loading, Status, get, queryRoot, useDate, useUrlValue } from './ui'
export default function ReceiptPage() {
  const evidenceId = useUrlValue('evidenceId'), date = useDate()
  const query = useQuery({ queryKey: [...queryRoot, 'receipt', evidenceId], queryFn: () => get<PublicReceipt>(API.receipt, { evidenceId }), enabled: !!evidenceId })
  const receipt = query.data
  return <PluginPage className="commissions commission-public"><h1>委托存证公开核验</h1><p>本回执仅展示摘要和链上状态，不公开合同正文、附件或客户资料。存证证明记录的一致性，不代替对合同内容的审查。</p>{!evidenceId ? <Alert type="warning" title="缺少存证记录编号" description="请使用完整的公开核验链接。" /> : query.isPending ? <Loading /> : <><ErrorNotice error={query.error} retry={() => { void query.refetch() }} />{receipt && <><Alert type={receipt.status === 'FINALIZED' ? 'success' : receipt.status === 'FAILED' ? 'error' : 'info'} showIcon title={receipt.status === 'FINALIZED' ? '已完成 Solana 主网最终确认' : '此记录尚未完成主网最终确认'} description={receipt.status === 'FINALIZED' ? '以下内容摘要已完成链上存证。' : '待确认、失败或撤回状态均不能作为业务已经生效的证明。'} /><Descriptions column={1} bordered items={[
    { key: 'id', label: '记录编号', children: receipt.evidenceId }, { key: 'status', label: '状态', children: <Status evidence value={receipt.status} /> }, { key: 'network', label: '网络', children: 'Solana 主网（Mainnet）' }, { key: 'digest', label: '内容摘要', children: <Typography.Paragraph className="commission-break" copyable>{receipt.digest}</Typography.Paragraph> }, { key: 'memo', label: '链上摘要标记', children: <Typography.Paragraph className="commission-break" copyable>{receipt.memo}</Typography.Paragraph> }, { key: 'date', label: '最终确认时间', children: date(receipt.finalizedAt) }, ...(receipt.signature ? [{ key: 'signature', label: '交易签名', children: <a className="commission-break" href={`https://explorer.solana.com/tx/${encodeURIComponent(receipt.signature)}`} target="_blank" rel="noopener noreferrer">{receipt.signature}</a> }] : []),
  ]} /><Button onClick={() => { void query.refetch() }} loading={query.isFetching}>重新核验状态</Button></>}</>}</PluginPage>
}
