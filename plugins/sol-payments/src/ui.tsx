import { useLocale, Alert, Descriptions, Typography } from '@slothvault/plugin-sdk/client'
import { formatSol } from './pricing'
export const ID = 'slothvault.sol-payments'
export type Order = { id: string; userId: number | null; points: number; payer: string; recipient: string; lamports: string; rate: string; quote: { price: string; provider: string; observedAt: string }; status: string; expiresAt: string; createdAt: string; signature: string | null; slot: string | null; reason: string | null }
export type Options = { salesEnabled: boolean; recipient: string; pointsPerUsdt: string; minPoints: number; maxPoints: number }
const copy = {
  zh: { network: '网络', title: '购买积分', intro: '通过 Solana Mainnet 使用 SOL 购买积分。报价锁定 5 分钟，网络手续费另付。', connect: '连接钱包', wallet: '付款钱包', points: '购买积分数', quote: '获取报价', pay: '确认并使用钱包付款', newOrder: '重新购买', amount: '应付 SOL', received: '到账积分', recipient: '收款地址', rate: '每 USDT 对应积分', price: 'SOL/USDT 行情', source: '行情来源', expires: '报价有效至', remaining: '剩余秒数', history: '购买记录', inspect: '查看', check: '检查到账', id: '订单号', user: '用户 ID', created: '创建时间', status: '状态', signature: '链上交易', refresh: '刷新', paused: '暂未开放新订单；已有有效订单可以继续付款。', pending: '正在等待链上最终确认。请勿再次付款；关闭页面后仍会继续核验。', review: '付款需要进一步核验，请保留订单号。系统不会要求重复付款。', success: '积分已到账。', error: '操作未完成，请刷新订单状态后重试。', expired: '报价已过期，请重新获取报价。', admin: 'SOL 收款订单', adminIntro: '暂停销售请使用插件配置中的 salesEnabled；完整禁用插件会暂停所有补查，重新启用后恢复。', configure: '打开插件配置', filter: '查询', all: '全部状态', noData: '暂无订单', retry: '重试', loadFailed: '暂时无法读取数据，请重试。', balance: '付款钱包需同时有足够的转账金额和网络手续费。', quoteTime: '行情时间', details: '订单详情', seconds: '秒', reasons: '处理说明', requestPending: '请求结果尚未确认，请点击获取报价重试同一请求。' },
  en: { network: 'Network', title: 'Buy points', intro: 'Pay with SOL on Solana Mainnet. Quotes are locked for 5 minutes; network fees are additional.', connect: 'Connect wallet', wallet: 'Paying wallet', points: 'Points to buy', quote: 'Get quote', pay: 'Confirm and pay with wallet', newOrder: 'New purchase', amount: 'SOL to pay', received: 'Points to receive', recipient: 'Recipient', rate: 'Points per USDT', price: 'SOL/USDT price', source: 'Price source', expires: 'Quote expires at', remaining: 'Seconds remaining', history: 'Purchase history', inspect: 'View', check: 'Check payment', id: 'Order ID', user: 'User ID', created: 'Created', status: 'Status', signature: 'On-chain transaction', refresh: 'Refresh', paused: 'New purchases are paused. Existing valid quotes can still be paid.', pending: 'Waiting for final confirmation. Do not pay again. Verification continues after you close this page.', review: 'This payment needs further verification. Keep the order ID; do not pay again.', success: 'Points credited.', error: 'The operation did not complete. Refresh the order before retrying.', expired: 'The quote expired. Request a new quote.', admin: 'SOL payment orders', adminIntro: 'Pause sales with salesEnabled in plugin configuration. Disabling the entire plugin stops reconciliation until re-enabled.', configure: 'Open plugin configuration', filter: 'Search', all: 'All statuses', noData: 'No orders yet', retry: 'Retry', loadFailed: 'Unable to load data. Please retry.', balance: 'Your wallet must cover both the payment and network fee.', quoteTime: 'Quote time', details: 'Order details', seconds: 'seconds', reasons: 'Resolution details', requestPending: 'The request outcome is unknown. Get quote retries the same request.' },
}
export function useCopy() { return copy[useLocale() === 'zh' ? 'zh' : 'en'] }
const states: Record<string, [string,string]> = { AWAITING_PAYMENT: ['待付款','Awaiting payment'], CONFIRMING: ['链上确认中','Confirming'], PAID: ['已到账','Credited'], EXPIRED: ['已过期','Expired'], FAILED: ['支付失败','Failed'], NEEDS_REVIEW: ['需要处理','Needs review'] }
export function useStatus() { const zh = useLocale() === 'zh'; return (value: string) => states[value]?.[zh ? 0 : 1] ?? value }
export function PaymentError({ error }: { error: unknown }) {
  const c = useCopy(), zh = useLocale() === 'zh'
  const message = error instanceof Error ? error.message : ''
  const translations: Record<string,[string,string]> = {
    PRICE_UNAVAILABLE: ['暂无有效行情，请稍后重新获取报价。','Fresh market prices are unavailable. Try again later.'],
    SALES_PAUSED: ['新订单已暂停。','New purchases are paused.'],
    ORDER_NOT_PAYABLE: ['订单已过期或正在处理，请刷新状态。','This order expired or is already processing. Refresh its status.'],
    PAYMENT_BALANCE_INSUFFICIENT: ['钱包余额不足，请保留转账金额及网络手续费。','Your wallet needs enough SOL for the payment and network fee.'],
    PAYMENT_PENDING: ['原交易仍在确认，请勿重复付款。','The original transaction is pending. Do not pay again.'],
    PAYMENT_RPC_UNAVAILABLE: ['链节点暂不可用，已提交的付款会继续补查。','The chain node is unavailable. Submitted payments will be checked again.'],
    EVIDENCE_WALLET_SIGNATURE_REJECTED: ['钱包未完成签名，可以重新尝试。','The wallet did not sign. You can retry.'],
    EVIDENCE_WALLET_CHANGED: ['付款钱包已变化，请连接订单中的付款钱包。','Connect the wallet used for this order.'],
    EVIDENCE_WALLET_UNSUPPORTED: ['该钱包不支持主网交易签名，请选择支持的钱包。','Select a wallet that supports Mainnet transaction signing.'],
    PAYMENT_TRANSACTION_INVALID: ['交易校验失败，请检查收款配置或刷新订单。','Transaction validation failed. Check the recipient configuration or refresh the order.'],
  }
  const known = Object.keys(translations).find(key => message.includes(key))
  return <Alert type="error" showIcon title={known ? translations[known][zh ? 0 : 1] : c.error} />
}
export function OrderDetails({ order }: { order: Order }) {
  const c = useCopy(), status = useStatus(), locale = useLocale()
  return <Descriptions column={1} size="small" items={[
    { key:'id', label:c.id, children:<Typography.Text copyable>{order.id}</Typography.Text> },
    { key:'status', label:c.status, children:status(order.status) },
    { key:'amount', label:c.amount, children:<Typography.Text strong>{formatSol(order.lamports)} SOL</Typography.Text> },
    { key:'points', label:c.received, children:order.points.toLocaleString(locale) },
    { key:'network', label:c.network, children:'Solana Mainnet' },
    { key:'payer', label:c.wallet, children:<Typography.Paragraph className="sol-payment-address" copyable>{order.payer}</Typography.Paragraph> },
    { key:'recipient', label:c.recipient, children:<Typography.Paragraph className="sol-payment-address" copyable>{order.recipient}</Typography.Paragraph> },
    { key:'rate', label:c.rate, children:order.rate },
    { key:'price', label:c.price, children:order.quote.price },
    { key:'source', label:c.source, children:order.quote.provider.toUpperCase() },
    { key:'time', label:c.quoteTime, children:new Date(order.quote.observedAt).toLocaleString(locale) },
    { key:'expires', label:c.expires, children:new Date(order.expiresAt).toLocaleString(locale) },
    ...(order.signature ? [{ key:'signature', label:c.signature, children:<Typography.Link href={`https://explorer.solana.com/tx/${order.signature}`} target="_blank" rel="noopener noreferrer">{c.signature}</Typography.Link> }] : []),
    ...(order.reason ? [{ key:'reason', label:c.reasons, children:order.reason === 'CREDIT_PENDING' ? c.review : c.pending }] : []),
  ]} />
}
