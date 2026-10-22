/**
 * @file manage.tsx
 * @project SlothVault
 * @module SOL Payment Administration
 * @description Shows immutable quotes and chain evidence with bounded administrator reconciliation.
 * @logic Filter orders, inspect receipts and trigger verification without manual success overrides.
 * @dependencies Plugin client SDK, React, shared payment UI
 * @index_tags plugins,payments,admin,orders
 * @author holic512
 */
import { useState } from 'react'
import { Alert, Button, Form, Input, InputNumber, Select, Space, Table, Drawer, api, useQuery, useMutation, useQueryClient, useRouter, PluginPage, PluginPageActions, PluginTablePanel } from '@slothvault/plugin-sdk/client'
import { ID,useCopy,useStatus,PaymentError,OrderDetails,type Order } from './ui'
export default function Manage() {
  const c=useCopy(),status=useStatus(),router=useRouter(),client=useQueryClient()
  const [filters,setFilters]=useState(''),[page,setPage]=useState(1),[selected,setSelected]=useState<Order|null>(null)
  const query=useQuery({queryKey:[ID,'admin',filters,page],queryFn:()=>api<{list:Order[];total:number}>(ID,`admin/orders?page=${page}&${filters}`)})
  const check=useMutation({mutationFn:(orderId:string)=>api<Order>(ID,'admin/reconcile',{method:'POST',body:JSON.stringify({orderId})}),onSuccess:async result=>{setSelected(result);await client.invalidateQueries({queryKey:[ID,'admin']})}})
  return <PluginPage><PluginPageActions><Button onClick={()=>router.push('/admin/mm/plugins')}>{c.configure}</Button><Button onClick={()=>void query.refetch()}>{c.refresh}</Button></PluginPageActions>
    <Alert type="info" showIcon title={c.adminIntro}/>
    <Form layout="inline" onFinish={values=>{const params=new URLSearchParams();for(const [k,v] of Object.entries(values))if(v)params.set(k,String(v));setFilters(params.toString());setPage(1)}}>
      <Form.Item name="userId" label={c.user}><InputNumber min={1} precision={0}/></Form.Item><Form.Item name="orderId" label={c.id}><Input/></Form.Item><Form.Item name="signature" label={c.signature}><Input/></Form.Item>
      <Form.Item name="status" label={c.status}><Select allowClear placeholder={c.all} options={['AWAITING_PAYMENT','CONFIRMING','PAID','EXPIRED','FAILED','NEEDS_REVIEW'].map(value=>({value,label:status(value)}))}/></Form.Item><Button htmlType="submit">{c.filter}</Button>
    </Form>
    {query.isError?<PaymentError error={query.error}/>:null}{check.isError?<PaymentError error={check.error}/>:null}
    <PluginTablePanel><Table<Order> rowKey="id" size="small" loading={query.isPending} dataSource={query.data?.list??[]} scroll={{x:900}} pagination={{current:page,pageSize:20,total:query.data?.total??0,onChange:setPage}} columns={[
      {title:c.id,dataIndex:'id'},{title:c.user,dataIndex:'userId'},{title:c.received,dataIndex:'points'},{title:c.status,dataIndex:'status',render:status},{title:c.created,dataIndex:'createdAt',render:v=>new Date(v).toLocaleString()},{title:c.details,key:'view',render:(_,row)=><Button type="link" onClick={()=>setSelected(row)}>{c.inspect}</Button>},
    ]}/></PluginTablePanel>
    <Drawer open={!!selected} onClose={()=>setSelected(null)} title={c.details}>{selected?<Space orientation="vertical"><OrderDetails order={selected}/>{['CONFIRMING','NEEDS_REVIEW'].includes(selected.status)?<Button loading={check.isPending} onClick={()=>check.mutate(selected.id)}>{c.check}</Button>:null}</Space>:null}</Drawer>
  </PluginPage>
}
