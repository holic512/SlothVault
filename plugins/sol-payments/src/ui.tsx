/**
 * @file ui.tsx
 * @project SlothVault
 * @module SOL Payment Presentation
 * @description Resolves plugin-owned localized copy, payment states, errors and immutable order details.
 * @logic Read the inherited locale through next-intl, translate known failures and format dates and numbers without changing payment evidence.
 * @dependencies Plugin client SDK, messages, pricing
 * @index_tags plugins,payments,i18n,orders
 * @author holic512
 */
import { useLocale, useTranslations, Alert, Descriptions, Typography } from '@slothvault/plugin-sdk/client'
import { messages } from './messages'
import { formatSol } from './pricing'
export const ID = 'slothvault.sol-payments'
export type Order = { id: string; userId: number | null; points: number; payer: string; recipient: string; lamports: string; rate: string; quote: { price: string; provider: string; observedAt: string }; status: string; expiresAt: string; createdAt: string; signature: string | null; slot: string | null; reason: string | null }
export type Options = { salesEnabled: boolean; recipient: string; pointsPerUsdt: string; minPoints: number; maxPoints: number }

const copyKeys = ["network","title","intro","connect","wallet","points","quote","pay","newOrder","amount","received","recipient","rate","price","source","expires","remaining","history","inspect","check","id","user","created","status","signature","refresh","paused","pending","review","success","error","expired","admin","adminIntro","configure","filter","all","noData","retry","loadFailed","balance","quoteTime","details","seconds","reasons","requestPending","connected","disconnected","switchWallet","walletMismatch","walletRequired","pointsRequired","pointsInvalid","unknownStatus","reset","noResults","viewFullAddress"] as const
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
