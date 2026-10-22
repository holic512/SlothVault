/**
 * @file purchase.tsx
 * @project SlothVault
 * @module SOL Purchase Page
 * @description Lets signed-in users review a locked quote and sign its exact native SOL transfer.
 * @logic Recover orders by URL, retain request idempotency, reconcile pending payments and refresh host balances after settlement.
 * @dependencies Plugin client SDK, React, payment UI
 * @index_tags plugins,payments,wallet,account
 * @author holic512
 */
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Form, InputNumber, Space, Table, Typography, api, invalidateAccount, usePluginWallet, useQuery, useQueryClient, useMutation } from '@slothvault/plugin-sdk/client'
import { ID, useCopy, useStatus, PaymentError, OrderDetails, type Order, type Options } from './ui'
export default function Purchase() {
  const c = useCopy(), status = useStatus(), wallet = usePluginWallet(), queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(() => typeof window === 'undefined' ? null : new URL(window.location.href).searchParams.get('order'))
  const [page, setPage] = useState(1), [error, setError] = useState<unknown>(null), [now, setNow] = useState(() => Date.now())
  const request = useRef<{ points: number; payer: string; requestKey: string } | null>(null)
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
  const connect = useMutation({ mutationFn:()=>wallet.requestConnection(), onError:setError })
  const quote = useMutation({ mutationFn:async ({ points }: { points:number }) => {
    if (!wallet.address) throw new Error('EVIDENCE_WALLET_CHANGED')
    if (!request.current || request.current.points !== points || request.current.payer !== wallet.address) request.current={points,payer:wallet.address,requestKey:crypto.randomUUID()}
    return api<Order>(ID,'orders',{method:'POST',body:JSON.stringify(request.current)})
  },onSuccess:async result=>{ request.current=null; setError(null); select(result.id); queryClient.setQueryData([ID,'order',result.id],result); await refresh() },onError:setError })
  const pay = useMutation({ mutationFn:async () => {
    if (!order || wallet.address !== order.payer) throw new Error('EVIDENCE_WALLET_CHANGED')
    const result=await api<{attemptId:string;prepared:{transactionBase64:string}}>(ID,'payment/prepare',{method:'POST',body:JSON.stringify({orderId:order.id})})
    const signedTransaction=await wallet.signPreparedTransaction(result.prepared.transactionBase64,'mainnet',result.attemptId)
    return api<Order>(ID,'payment/submit',{method:'POST',body:JSON.stringify({orderId:order.id,attemptId:result.attemptId,signedTransaction})})
  },onSuccess:async()=>{setError(null);await refresh()},onError:async e=>{setError(e);await refresh()} })
  const reconcile=useMutation({mutationFn:()=>api(ID,'payment/reconcile',{method:'POST',body:JSON.stringify({orderId:order?.id})}),onSuccess:refresh,onError:setError})
  const remaining=order?Math.max(0,Math.ceil((Date.parse(order.expiresAt)-now)/1000)):0
  return <div className="account-route sol-payments">
    <Typography.Title level={3}>{c.title}</Typography.Title><Typography.Paragraph type="secondary">{c.intro}</Typography.Paragraph>
    {error?<PaymentError error={error}/>:null}
    {options.isError || orderQuery.isError || history.isError ? <Alert type="error" title={c.loadFailed} action={<Button onClick={()=>{void options.refetch();void history.refetch();if(selectedId)void orderQuery.refetch()}}>{c.retry}</Button>}/>:null}
    <Card className="account-route-card" size="small" title={c.wallet}><Space wrap><Typography.Text className="sol-payment-address">{wallet.address ?? '—'}</Typography.Text><Button loading={connect.isPending} onClick={()=>connect.mutate()}>{c.connect}</Button></Space></Card>
    {!selectedId ? <Card className="account-route-card" size="small" title={c.points} loading={options.isPending}>
      {options.data&&!options.data.salesEnabled?<Alert type="info" title={c.paused}/>:null}
      <Form layout="vertical" onFinish={values=>quote.mutate(values as {points:number})}>
        <Form.Item name="points" label={c.points} rules={[{required:true,message:c.points},{type:'integer',min:options.data?.minPoints??1,max:options.data?.maxPoints??1000000,message:c.points}]}><InputNumber min={options.data?.minPoints??1} max={options.data?.maxPoints??1000000} precision={0}/></Form.Item>
        <Button type="primary" htmlType="submit" loading={quote.isPending} disabled={!wallet.address||!options.data?.salesEnabled}>{c.quote}</Button>
      </Form>
    </Card>:<Card className="account-route-card" size="small" title={c.details} loading={orderQuery.isPending}>
      {order?<><OrderDetails order={order}/>
        {order.status==='CONFIRMING'?<Alert type="info" showIcon title={c.pending}/>:order.status==='PAID'?<Alert type="success" showIcon title={c.success}/>:order.status==='NEEDS_REVIEW'?<Alert type="warning" showIcon title={c.review}/>:null}
        {order.status==='AWAITING_PAYMENT'&&remaining>0?<Space orientation="vertical"><Typography.Text>{c.remaining}: {remaining} {c.seconds}</Typography.Text><Typography.Text type="secondary">{c.balance}</Typography.Text><Button type="primary" loading={pay.isPending} disabled={wallet.address!==order.payer} onClick={()=>pay.mutate()}>{c.pay}</Button></Space>:null}
        {order.status==='EXPIRED'||order.status==='AWAITING_PAYMENT'&&!remaining?<Alert type="warning" title={c.expired}/>:null}
        <Space wrap>{['CONFIRMING','NEEDS_REVIEW'].includes(order.status)?<Button loading={reconcile.isPending} onClick={()=>reconcile.mutate()}>{c.check}</Button>:<Button disabled={pay.isPending} onClick={()=>select(null)}>{c.newOrder}</Button>}<Button onClick={()=>void refresh()}>{c.refresh}</Button></Space>
      </>:null}
    </Card>}
    <Card className="account-route-card" title={c.history} size="small"><Table<Order> size="small" rowKey="id" loading={history.isPending} dataSource={history.data?.list??[]} scroll={{x:640}} locale={{emptyText:c.noData}} pagination={{current:page,pageSize:20,total:history.data?.total??0,onChange:setPage}} columns={[
      {title:c.created,dataIndex:'createdAt',render:v=>new Date(v).toLocaleString()}, {title:c.received,dataIndex:'points'}, {title:c.status,dataIndex:'status',render:status}, {title:c.details,key:'view',render:(_,row)=><Button type="link" onClick={()=>select(row.id)}>{c.inspect}</Button>},
    ]}/></Card>
  </div>
}
