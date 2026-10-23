/**
 * @file purchase.tsx
 * @project SlothVault
 * @module Solana Purchase Page
 * @description Presents USDT-first purchases with optional SOL, wallet identity and asset-specific locked amounts.
 * @logic Bind idempotency to points, wallet and asset, recover old SOL orders, and refresh host balances after settlement.
 * @dependencies Plugin client SDK, React, payment UI
 * @index_tags plugins,payments,wallet,account
 * @author holic512
 */
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, PluginAccountCard, PluginI18nProvider, Tag, Form, InputNumber, Select, Space, Table, Typography, api, invalidateAccount, usePluginWallet, useQuery, useQueryClient, useMutation, useLocale, useTranslations } from '@slothvault/plugin-sdk/client'
import { messages } from './messages'
import { ID, useCopy, useStatus, PaymentError, OrderDetails, formatOrderAmount, type Order, type Options, type PaymentAsset } from './ui'
export default function Purchase() {
  return <PluginI18nProvider messages={messages}><PurchaseContent /></PluginI18nProvider>
}

function PurchaseContent() {
  const locale = useLocale(), t = useTranslations('Plugins.solPayments')
  const c = useCopy(), status = useStatus(), wallet = usePluginWallet(), queryClient = useQueryClient()
  const [form] = Form.useForm<{ points: number; asset: PaymentAsset }>()
  const asset: PaymentAsset = Form.useWatch('asset', form) ?? 'USDT'
  const [selectedId, setSelectedId] = useState<string | null>(() => typeof window === 'undefined' ? null : new URL(window.location.href).searchParams.get('order'))
  const [page, setPage] = useState(1), [error, setError] = useState<unknown>(null), [now, setNow] = useState(() => Date.now())
  const request = useRef<{ points: number; payer: string; asset: PaymentAsset; requestKey: string } | null>(null)
  const select = (id: string | null) => { setSelectedId(id); const url = new URL(window.location.href); if (id) url.searchParams.set('order',id); else url.searchParams.delete('order'); window.history.replaceState(null,'',url) }
  const options = useQuery({ queryKey:[ID,'options'], queryFn:()=>api<Options>(ID,'purchase-options'), retry:false })
  const history = useQuery({ queryKey:[ID,'history',page], queryFn:()=>api<{ list:Order[]; total:number }>(ID,`orders?page=${page}`), refetchInterval:15000 })
  const orderQuery = useQuery({ queryKey:[ID,'order',selectedId], queryFn:()=>api<Order>(ID,`order?orderId=${encodeURIComponent(selectedId!)}`), enabled:!!selectedId, refetchInterval:query => ['CONFIRMING','NEEDS_REVIEW'].includes(query.state.data?.status ?? '') ? 5000 : false, retry:false })
  const order = orderQuery.data
  const orderId = order?.id, orderStatus = order?.status
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({queryKey:[ID,'order']}),queryClient.invalidateQueries({queryKey:[ID,'history']})]) }
  useEffect(() => { const timer = setInterval(()=>setNow(Date.now()),1000); return ()=>clearInterval(timer) },[])
  useEffect(() => { if(orderStatus === 'PAID') { void invalidateAccount(); void queryClient.invalidateQueries({queryKey:[ID,'history']}) } },[orderStatus,queryClient])
  useEffect(() => {
    if (!orderId || !['CONFIRMING','NEEDS_REVIEW'].includes(orderStatus ?? '')) return
    const id = orderId
    const timer = setInterval(()=>{ void api(ID,'payment/reconcile',{method:'POST',body:JSON.stringify({orderId:id})}).then(()=>queryClient.invalidateQueries({queryKey:[ID,'order',id]})).catch(()=>undefined) },15000)
    return ()=>clearInterval(timer)
  },[orderId,orderStatus,queryClient])
  const connect = useMutation({ mutationFn:()=>wallet.requestConnection({ forceSelect: wallet.connected }), onSuccess:()=>setError(null), onError:setError })
  const quote = useMutation({ mutationFn:async ({ points, asset }: { points:number; asset:PaymentAsset }) => {
    if (!wallet.connected) throw new Error('WALLET_DISCONNECTED')
    if (!wallet.address) throw new Error('EVIDENCE_WALLET_CHANGED')
    if (!request.current || request.current.points !== points || request.current.payer !== wallet.address || request.current.asset !== asset) request.current={points,payer:wallet.address,asset,requestKey:crypto.randomUUID()}
    return api<Order>(ID,'orders',{method:'POST',body:JSON.stringify(request.current)})
  },onSuccess:async result=>{ request.current=null; setError(null); select(result.id); queryClient.setQueryData([ID,'order',result.id],result); await refresh() },onError:setError })
  const pay = useMutation({ mutationFn:async () => {
    if (!wallet.connected) throw new Error('WALLET_DISCONNECTED')
    if (!order || wallet.address !== order.payer) throw new Error('EVIDENCE_WALLET_CHANGED')
    const result=await api<{attemptId:string;prepared:{transactionBase64:string}}>(ID,'payment/prepare',{method:'POST',body:JSON.stringify({orderId:order.id})})
    const signedTransaction=await wallet.signPreparedTransaction(result.prepared.transactionBase64,'mainnet',result.attemptId)
    return api<Order>(ID,'payment/submit',{method:'POST',body:JSON.stringify({orderId:order.id,attemptId:result.attemptId,signedTransaction})})
  },onSuccess:async()=>{setError(null);await refresh()},onError:async e=>{setError(e);await refresh()} })
  const reconcile=useMutation({mutationFn:()=>api(ID,'payment/reconcile',{method:'POST',body:JSON.stringify({orderId:order?.id})}),onSuccess:refresh,onError:setError})
  const remaining=order?Math.max(0,Math.ceil((Date.parse(order.expiresAt)-now)/1000)):0
  const connected = wallet.connected && !!wallet.address
  const minPoints = options.data?.minPoints ?? 1, maxPoints = options.data?.maxPoints ?? 1000000
  return <div className="account-route sol-payments">
    <header className="sol-payment-heading"><Typography.Title level={3}>{c.title}</Typography.Title><Typography.Paragraph type="secondary">{c.intro}</Typography.Paragraph></header>
    {error?<PaymentError error={error}/>:null}
    {options.isError || orderQuery.isError || history.isError ? <Alert type="error" title={c.loadFailed} action={<Button onClick={()=>{void options.refetch();void history.refetch();if(selectedId)void orderQuery.refetch()}}>{c.retry}</Button>}/>:null}
    <PluginAccountCard className="account-route-card" title={c.wallet}>
      <div className="sol-wallet-summary">
        <div className="sol-wallet-identity">
          <Space wrap><Tag color={connected ? 'success' : 'default'}>{connected ? c.connected : c.disconnected}</Tag>{connected && wallet.walletName ? <Typography.Text strong>{wallet.walletName}</Typography.Text> : null}</Space>
          {connected && wallet.address ? <Typography.Text className="sol-payment-address" title={wallet.address} copyable={{ text: wallet.address }}>{wallet.address.slice(0, 6)}…{wallet.address.slice(-6)}</Typography.Text> : <Typography.Text type="secondary">{c.walletRequired}</Typography.Text>}
          {connected && wallet.address ? <details><summary>{c.viewFullAddress}</summary><Typography.Text className="sol-payment-address">{wallet.address}</Typography.Text></details> : null}
        </div>
        <Button loading={connect.isPending} onClick={()=>connect.mutate()}>{connected ? c.switchWallet : c.connect}</Button>
      </div>
    </PluginAccountCard>
    {!selectedId ? <PluginAccountCard className="account-route-card" title={c.points} loading={options.isPending}>
      {options.data&&!options.data.salesEnabled?<Alert type="info" title={c.paused}/>:null}
      <Form form={form} className="sol-purchase-form" layout="vertical" initialValues={{ asset: options.data?.defaultAsset ?? 'USDT' }} disabled={!options.data?.salesEnabled} onFinish={values=>quote.mutate(values)}>
        <div className="sol-purchase-fields">
        <Form.Item name="asset" label={c.asset} extra={asset === 'USDT' ? c.usdtHint : c.solHint}>
          <Select className="sol-payment-asset" onChange={()=>setError(null)} options={[
            { value: 'USDT', label: c.usdtOption },
            { value: 'SOL', label: c.solOption },
          ].filter(option => !options.data?.assets || options.data.assets.includes(option.value as PaymentAsset))} />
        </Form.Item>
        <Form.Item name="points" label={c.points} extra={t('pointsRange', { min: minPoints, max: maxPoints })} rules={[{required:true,message:c.pointsRequired},{type:'integer',min:minPoints,max:maxPoints,message:c.pointsInvalid}]}><InputNumber min={minPoints} max={maxPoints} precision={0} className="sol-points-input" /></Form.Item>
        </div>
        <Typography.Paragraph type="secondary">{asset === 'USDT' ? c.usdtBalance : c.balance}</Typography.Paragraph>
        <Button type="primary" htmlType="submit" loading={quote.isPending} disabled={!connected||!options.data?.salesEnabled}>{c.quote}</Button>
      </Form>
    </PluginAccountCard>:<PluginAccountCard className="account-route-card" title={c.details} loading={orderQuery.isPending}>
      {order?<div className="sol-order-detail"><OrderDetails order={order}/>
        <div className="sol-order-checkout">
        {order.status==='CONFIRMING'?<Alert type="info" showIcon title={c.pending}/>:order.status==='PAID'?<Alert type="success" showIcon title={c.success}/>:order.status==='NEEDS_REVIEW'?<Alert type="warning" showIcon title={c.review}/>:null}
        {order.status==='AWAITING_PAYMENT' && (!connected || wallet.address !== order.payer) ? <Alert type="warning" showIcon title={connected ? c.walletMismatch : c.walletRequired} /> : null}
        {order.status==='AWAITING_PAYMENT'&&remaining>0?<div className="sol-payment-instructions">
          <Typography.Text>{c.remaining}: <Typography.Text strong className="sol-payment-countdown">{remaining} {c.seconds}</Typography.Text></Typography.Text>
          <Typography.Paragraph className="sol-payment-fees" type="secondary">{order.asset === 'USDT' ? c.usdtBalance : c.balance}</Typography.Paragraph>
        </div>:null}
        {order.status==='EXPIRED'||order.status==='AWAITING_PAYMENT'&&!remaining?<Alert type="warning" title={c.expired}/>:null}
        <div className="sol-payment-actions">
          {order.status==='AWAITING_PAYMENT'&&remaining>0?<Button type="primary" loading={pay.isPending} disabled={!connected||wallet.address!==order.payer} onClick={()=>pay.mutate()}>{c.pay}</Button>:null}
          <div className="sol-payment-secondary-actions">{['CONFIRMING','NEEDS_REVIEW'].includes(order.status)?<Button loading={reconcile.isPending} onClick={()=>reconcile.mutate()}>{c.check}</Button>:<Button disabled={pay.isPending} onClick={()=>select(null)}>{c.newOrder}</Button>}<Button onClick={()=>void refresh()}>{c.refresh}</Button></div>
        </div>
        </div>
      </div>:null}
    </PluginAccountCard>}
    <PluginAccountCard className="account-route-card" title={c.history}><Table<Order> size="small" rowKey="id" loading={history.isPending} dataSource={history.data?.list??[]} scroll={history.data?.list.length ? {x:760} : undefined} locale={{emptyText:c.noData}} pagination={{current:page,pageSize:20,total:history.data?.total??0,onChange:setPage,hideOnSinglePage:true}} columns={[
      {title:c.created,dataIndex:'createdAt',render:v=>new Date(v).toLocaleString(locale)}, {title:c.amount,key:'amount',render:(_,row)=>formatOrderAmount(row)}, {title:c.received,dataIndex:'points',render:v=>Number(v).toLocaleString(locale)}, {title:c.status,dataIndex:'status',render:status}, {title:c.details,key:'view',render:(_,row)=><Button type="link" onClick={()=>select(row.id)}>{c.inspect}</Button>},
    ]}/></PluginAccountCard>
  </div>
}
