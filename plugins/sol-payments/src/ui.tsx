/**
 * @file ui.tsx
 * @project SlothVault
 * @module Solana Payment Presentation
 * @description Resolves plugin-owned localized copy, payment states and immutable USDT or SOL order details.
 * @logic Format asset-specific amounts, preserve legacy SOL orders and show market data only for SOL quotes.
 * @dependencies Plugin client SDK, messages, pricing
 * @index_tags plugins,payments,i18n,orders
 * @author holic512
 */
import { useLocale, useTranslations, Alert, Descriptions, Typography } from '@slothvault/plugin-sdk/client'
import { messages } from './messages'
import { formatPayment } from './pricing'
export const ID = 'slothvault.sol-payments'
export type PaymentAsset = 'USDT' | 'SOL'
export type Order = { id: string; userId: number | null; points: number; payer: string; recipient: string; asset?: PaymentAsset; amount?: string; lamports: string; rate: string; quote: { price: string; provider: string; observedAt: string } | null; status: string; expiresAt: string; createdAt: string; signature: string | null; slot: string | null; reason: string | null }
export type Options = { salesEnabled: boolean; recipient: string; pointsPerUsdt: string; minPoints: number; maxPoints: number; assets: PaymentAsset[]; defaultAsset: PaymentAsset }

export function formatOrderAmount(order: Order) {
  const asset = order.asset ?? 'SOL'
  return `${formatPayment(order.amount ?? order.lamports, asset)} ${asset}`
}

const copyKeys = ["network","title","intro","connect","wallet","points","quote","pay","newOrder","asset","usdtOption","solOption","usdtHint","solHint","usdtBalance","amount","received","recipient","rate","price","source","expires","remaining","history","inspect","check","id","user","created","status","signature","refresh","paused","pending","review","success","error","expired","admin","adminIntro","configure","filter","all","noData","retry","loadFailed","balance","quoteTime","details","seconds","reasons","requestPending","connected","disconnected","switchWallet","walletMismatch","walletRequired","pointsRequired","pointsInvalid","unknownStatus","reset","noResults","viewFullAddress"] as const
export function useCopy() {
  const t = useTranslations('Plugins.solPayments')
  return Object.fromEntries(copyKeys.map(key => [key, t(key)])) as Record<typeof copyKeys[number], string>
}
export function useStatus() {
  const t = useTranslations('Plugins.solPayments')
  return (value: string) => t.has(`states.${value}`) ? t(`states.${value}`) : t('unknownStatus')
}
export function PaymentError({ error }: { error: unknown }) {
  const t = useTranslations('Plugins.solPayments')
  const message = error instanceof Error ? error.message : ''
  const known = Object.keys(messages.en.Plugins.solPayments.errors).find(key => message.includes(key))
  return <Alert type="error" showIcon title={known ? t(`errors.${known}`) : t('error')} />
}
export function OrderDetails({ order }: { order: Order }) {
  const c = useCopy(), status = useStatus(), locale = useLocale()
  const asset = order.asset ?? 'SOL'
  return <Descriptions column={1} size="small" items={[
    { key:'id', label:c.id, children:<Typography.Text copyable>{order.id}</Typography.Text> },
    { key:'status', label:c.status, children:status(order.status) },
    { key:'amount', label:c.amount, children:<Typography.Text strong>{formatOrderAmount(order)}</Typography.Text> },
    { key:'points', label:c.received, children:order.points.toLocaleString(locale) },
    { key:'network', label:c.network, children:'Solana Mainnet' },
    { key:'payer', label:c.wallet, children:<Typography.Paragraph className="sol-payment-address" copyable>{order.payer}</Typography.Paragraph> },
    { key:'recipient', label:c.recipient, children:<Typography.Paragraph className="sol-payment-address" copyable>{order.recipient}</Typography.Paragraph> },
    { key:'rate', label:c.rate, children:order.rate },
    ...(asset === 'SOL' && order.quote ? [
      { key:'price', label:c.price, children:order.quote.price },
      { key:'source', label:c.source, children:order.quote.provider.toUpperCase() },
      { key:'time', label:c.quoteTime, children:new Date(order.quote.observedAt).toLocaleString(locale) },
    ] : []),
    { key:'expires', label:c.expires, children:new Date(order.expiresAt).toLocaleString(locale) },
    ...(order.signature ? [{ key:'signature', label:c.signature, children:<Typography.Link href={`https://explorer.solana.com/tx/${order.signature}`} target="_blank" rel="noopener noreferrer">{c.signature}</Typography.Link> }] : []),
    ...(order.reason ? [{ key:'reason', label:c.reasons, children:order.reason === 'CREDIT_PENDING' ? c.review : c.pending }] : []),
  ]} />
}
