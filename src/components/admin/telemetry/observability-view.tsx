'use client'
/**
 * @file observability-view.tsx
 * @project SlothVault
 * @module Application Observability Dashboard
 * @description Makes request volume, preparation latency, lock contention and sampled failures inspectable.
 * @logic Keep fleet-wide window metrics separate from table filters, explain reference-line diagnoses without asserting root causes, and preserve errors and sampling boundaries in detail drawers.
 * @dependencies React Query, Ant Design, next-intl, telemetry contracts/charts
 * @index_tags admin,observability,request,latency,diagnostics
 * @author holic512
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Descriptions, Drawer, Select, Table, Tag, Tooltip } from 'antd'
import { useLocale, useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import { AdminPage } from '@/components/admin/admin-page'
import { apiFetch } from '@/lib/api-client'
import type { ObservabilityData, ObservabilityRange, RequestSample, RequestSamplesData, RouteMetric } from '@/types/telemetry'
import { DashboardHeader, dateValue, EmptyData, Failure, LoadingDashboard, Metric, numberValue, Panel, useTelemetryControls } from './shared'
import styles from '@/styles/modules/telemetry.module.css'
const Chart=dynamic(()=>import('./telemetry-chart'),{ssr:false})
const ranges:ObservabilityRange[]=['15m','1h','24h','7d']
export function ObservabilityView(){
  const t=useTranslations('AdminMM.telemetry'),locale=useLocale(),{search,update,visible}=useTelemetryControls()
  const range=ranges.includes(search.get('range') as ObservabilityRange)?search.get('range') as ObservabilityRange:'1h'
  const route=search.get('route')||undefined,method=search.get('method')||undefined,kind=['error','slow','normal'].includes(search.get('kind')||'')?search.get('kind')!:undefined,status=['4','5'].includes(search.get('status')||'')?search.get('status')!:undefined
  const page=Math.max(1,Math.min(10000,Number(search.get('page'))||1)), [selected,setSelected]=useState<RequestSample|null>(null)
  const query=useQuery({queryKey:['telemetry-observability',range],queryFn:()=>apiFetch<ObservabilityData>(`/api/admin/mm/observability?range=${range}`),refetchInterval:visible?15000:false,retry:1})
  const sampleParams=new URLSearchParams({range,page:String(page)});for(const [key,value]of Object.entries({route,method,kind,status}))if(value)sampleParams.set(key,value)
  const samples=useQuery({queryKey:['telemetry-samples',sampleParams.toString()],queryFn:()=>apiFetch<RequestSamplesData>(`/api/admin/mm/observability/requests?${sampleParams}`),refetchInterval:visible?15000:false,retry:1})
  const data=query.data,n=(value:number|null|undefined,decimals=0)=>numberValue(locale,value,decimals),ms=(value:number|null)=>value===null?'—':`${n(value,1)} ms`
  const latencyLabels=useMemo(()=>[t('observability.average'),t('observability.p95')],[t]),requestLabels=useMemo(()=>[t('observability.rate')],[t])
  const diagnosis=(row:RouteMetric)=>row.errors5?'serverErrors':row.waitMs!==null&&row.averageMs!==null&&row.waitMs>=100&&row.waitMs>=row.averageMs*.5?'waiting':row.regressed?'regressed':(row.averageMs??0)>row.averageLimitMs||(row.p95Ms??0)>row.slowLimitMs?'slow':!row.baselineReady?'insufficient':'normal'
  const filtered=data?.routes.filter(row=>(!route||row.route===route)&&(!method||row.method===method)&&(!status||(status==='5'?row.errors5>0:row.errors4>0)))||[]
  const routes=[...new Set(data?.routes.map(row=>row.route)||[])],methods=[...new Set(data?.routes.map(row=>row.method)||[])]
  const columns=[
    {title:t('observability.route'),key:'route',render:(_:unknown,row:RouteMetric)=><button className={styles['route-button']} type="button" onClick={()=>update({route:row.route,method:row.method,page:undefined})}><Tag>{row.method}</Tag><code>{row.route}</code>{row.category==='long'?<small>{t('observability.longOperation')}</small>:null}</button>,width:310},
    {title:t('observability.count'),dataIndex:'count',render:(value:number)=>n(value),sorter:(a:RouteMetric,b:RouteMetric)=>a.count-b.count,width:100},
    {title:t('observability.average'),dataIndex:'averageMs',render:(value:number|null)=>ms(value),sorter:(a:RouteMetric,b:RouteMetric)=>(a.averageMs||0)-(b.averageMs||0),width:110},
    {title:t('observability.p95'),dataIndex:'p95Ms',render:(value:number|null)=>ms(value),sorter:(a:RouteMetric,b:RouteMetric)=>(a.p95Ms||0)-(b.p95Ms||0),width:110},
    {title:t('observability.wait'),dataIndex:'waitMs',render:(value:number|null)=>ms(value),sorter:(a:RouteMetric,b:RouteMetric)=>(a.waitMs||0)-(b.waitMs||0),width:110},
    {title:t('observability.slowCount'),dataIndex:'slow',render:(value:number)=>n(value),sorter:(a:RouteMetric,b:RouteMetric)=>a.slow-b.slow,width:100},
    {title:t('observability.errorRate'),dataIndex:'errorRate',render:(value:number|null)=>`${n(value,1)}%`,sorter:(a:RouteMetric,b:RouteMetric)=>(a.errorRate||0)-(b.errorRate||0),width:100},
    {title:t('observability.diagnosis'),key:'diagnosis',render:(_:unknown,row:RouteMetric)=>{const state=diagnosis(row);return <Tooltip title={t('observability.reference',{average:row.averageLimitMs,slow:row.slowLimitMs,baseline:ms(row.baselineMs)})}><Tag color={state==='serverErrors'?'error':['waiting','regressed','slow'].includes(state)?'warning':state==='normal'?'success':undefined}>{t(`diagnoses.${state}`)}</Tag></Tooltip>},width:150},
  ]
  const sampleColumns=[
    {title:t('time'),dataIndex:'timestamp',render:(value:number)=>dateValue(locale,value),width:150},
    {title:t('observability.route'),key:'route',render:(_:unknown,row:RequestSample)=><span className={styles['sample-route']}><Tag>{row.method}</Tag><code>{row.route}</code></span>,width:310},
    {title:t('observability.status'),dataIndex:'status',render:(value:number)=><Tag color={value>=500?'error':value>=400?'warning':undefined}>{value}</Tag>,width:90},
    {title:t('observability.total'),dataIndex:'durationMs',render:ms,width:120},
    {title:t('sampleKind'),dataIndex:'kind',render:(value:string)=>t(`samples.${value}`),width:130},
    {title:'',key:'details',render:(_:unknown,row:RequestSample)=><Button size="small" onClick={()=>setSelected(row)}>{t('details')}</Button>,width:70},
  ]
  const summaryTone=data?.collection.state!=='healthy'?'warning':data.summary.errors5||data.summary.streamErrors?'warning':'info'
  const summaryLabel=data?.collection.state!=='healthy'?'observability.collectionIssue':data.summary.errors5?'observability.errorsSummary':data.summary.streamErrors?'observability.streamSummary':data.summary.slow?'observability.slowSummary':data.summary.count?'observability.normalSummary':'empty'
  return <AdminPage className={styles.root}>
    <DashboardHeader mode="observability" range={range} ranges={ranges} onRange={value=>update({range:value,page:undefined})} fetching={query.isFetching} refresh={()=>{void query.refetch();void samples.refetch()}} collection={data?.collection}/>
    {query.isError?<Failure stale={!!data} retry={()=>void query.refetch()}/>:null}
    {!data&&!query.isError?<LoadingDashboard/>:null}
    {data?<><Alert className={styles.summary} type={summaryTone} showIcon title={t(summaryLabel,{errors:data.summary.errors5,slow:data.summary.slow,streams:data.summary.streamErrors})} description={t('observability.summaryHint')}/>
    <div className={styles.metrics}>
      <Metric label={t('observability.count')} value={n(data.summary.count)} hint={t('observability.countHint')} comparison={`${n(data.summary.rps,2)} ${t('observability.perSecond')}`}/>
      <Metric label={t('observability.average')} value={n(data.summary.averageMs,1)} unit="ms" hint={t('observability.averageHint')}/>
      <Metric label={t('observability.p95')} value={n(data.summary.p95Ms,1)} unit="ms" hint={t('observability.p95Hint')}/>
      <Metric label={t('observability.errorRate')} value={n(data.summary.errorRate,2)} unit="%" hint={t('observability.errorHint')} comparison={`${t('observability.clientErrors')}: ${n(data.summary.errors4)} · ${t('observability.streamErrors')}: ${n(data.summary.streamErrors)}`}/>
    </div>
    <div className={styles['chart-grid']}>
      <Panel title={t('observability.requestTrend')} description={t('observability.rateHint')}>{data.summary.count?<Chart kind="requests" points={data.trend} labels={requestLabels} locale={locale} window={data.range} coverageStart={data.collection.epochStartedAt} summary={t('observability.requestSummary',{count:n(data.summary.count)})}/>:<EmptyData/>}</Panel>
      <Panel title={t('observability.latencyTrend')} description={t('observability.latencyHint')}>{data.summary.count?<Chart kind="latency" points={data.trend} labels={latencyLabels} locale={locale} window={data.range} coverageStart={data.collection.epochStartedAt} summary={t('observability.latencySummary',{average:ms(data.summary.averageMs),p95:ms(data.summary.p95Ms)})}/>:<EmptyData/>}</Panel>
    </div>
    <Panel title={t('observability.routes')} description={t('observability.routesHint')} actions={<div className={styles['panel-actions']}><Select size="small" allowClear showSearch aria-label={t('observability.route')} placeholder={t('observability.allRoutes')} value={route} options={routes.map(value=>({value,label:value}))} onChange={value=>update({route:value,page:undefined})} className={styles['route-select']}/><Select size="small" allowClear aria-label={t('observability.method')} placeholder={t('observability.method')} value={method} options={methods.map(value=>({value,label:value}))} onChange={value=>update({method:value,page:undefined})}/><Select size="small" allowClear aria-label={t('observability.status')} placeholder={t('observability.status')} value={status} options={['4','5'].map(value=>({value,label:`${value}xx`}))} onChange={value=>update({status:value,page:undefined})}/></div>}>
      <Table size="small" rowKey={row=>`${row.method}:${row.route}`} dataSource={filtered} columns={columns} pagination={{pageSize:10,showSizeChanger:false}} scroll={{x:1200}} locale={{emptyText:<EmptyData/>}}/>
    </Panel>
    <Panel title={t('observability.samples')} description={t('observability.samplesHint')} actions={<Select size="small" allowClear placeholder={t('sampleKind')} aria-label={t('sampleKind')} value={kind} options={['error','slow','normal'].map(value=>({value,label:t(`samples.${value}`)}))} onChange={value=>update({kind:value,page:undefined})}/>}>
      {samples.isError?<Failure stale={!!samples.data} retry={()=>void samples.refetch()}/>:null}
      <Table size="small" rowKey="id" loading={samples.isPending} dataSource={samples.data?.items||[]} columns={sampleColumns} scroll={{x:900}} pagination={{current:page,pageSize:20,total:samples.data?.total||0,showSizeChanger:false,onChange:value=>update({page:String(value)})}} locale={{emptyText:<EmptyData/>}}/>
    </Panel>
    <Panel title={t('observability.runtime')} description={t('observability.runtimeHint')}><div className={styles['runtime-grid']}>
      <div><span>{t('observability.uptime')}</span><strong>{n(data.runtime.uptimeSeconds/3600,1)} h</strong></div>
      <div><span>{t('observability.memory')}</span><strong>{n(data.runtime.rssBytes/1048576,1)} MB</strong></div>
      <div><span>{t('observability.heap')}</span><strong>{n(data.runtime.heapUsedBytes/1048576,1)} / {n(data.runtime.heapTotalBytes/1048576,1)} MB</strong></div>
      <div><span>{t('observability.eventLoop')}</span><strong>{ms(data.runtime.eventLoopP95Ms)}</strong></div>
      <div><span>{t('observability.database')}</span><strong>{t(`databaseStates.${data.runtime.databaseStatus==='INSTALLED'?'healthy':'maintenance'}`)}</strong></div>
      <div><span>{t('observability.store')}</span><strong>{t(`states.${data.collection.state}`)}</strong></div>
    </div></Panel><p className={styles.footnote}>{t('observability.boundary')}</p>
    </>:null}
    <Drawer className={styles.drawer} title={t('observability.requestDetail')} open={!!selected} onClose={()=>setSelected(null)} size={560}>{selected?<><p className={styles.footnote}>{t('observability.detailHint')}</p><Descriptions column={1} bordered size="small" items={[
      {key:'id',label:t('observability.requestId'),children:<code>{selected.id}</code>},{key:'time',label:t('time'),children:dateValue(locale,selected.timestamp)},
      {key:'route',label:t('observability.route'),children:<code>{selected.method} {selected.route}</code>},{key:'status',label:t('observability.status'),children:selected.status},
      {key:'total',label:t('observability.total'),children:ms(selected.durationMs)},{key:'wait',label:t('observability.wait'),children:ms(selected.waitMs)},
      {key:'handler',label:t('observability.handler'),children:ms(selected.handlerMs)},{key:'kind',label:t('sampleKind'),children:t(`samples.${selected.kind}`)},
      ...(selected.streamState?[{key:'stream',label:t('observability.streamState'),children:t(`streams.${selected.streamState}`)},{key:'streamMs',label:t('observability.streamDuration'),children:ms(selected.streamMs??null)}]:[]),
    ]}/></>:null}</Drawer>
  </AdminPage>
}
