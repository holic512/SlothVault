'use client'
/**
 * @file analytics-view.tsx
 * @project SlothVault
 * @module Operations Analytics Dashboard
 * @description Explains public audience activity and effective content reading without opaque popularity scores.
 * @logic Load URL-selected windows, keep previous results on transient failures, rank content by explicit measures, and drill into per-content trends.
 * @dependencies React Query, Ant Design, next-intl, telemetry chart and contracts
 * @index_tags admin,analytics,reading,hotspots,heatmap
 * @author holic512
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Drawer, Segmented, Select, Table, Tag } from 'antd'
import { ArrowUpRight } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { AdminPage } from '@/components/admin/admin-page'
import { apiFetch } from '@/lib/api-client'
import type { AnalyticsData, AnalyticsRange, ContentKind, ContentMetric, ContentSort } from '@/types/telemetry'
import { changeLabel, DashboardHeader, EmptyData, Failure, LoadingDashboard, Metric, numberValue, Panel, useTelemetryControls } from './shared'
import styles from '@/styles/modules/telemetry.module.css'
const Chart=dynamic(()=>import('./telemetry-chart'),{ssr:false})
const ranges:AnalyticsRange[]=['today','7d','30d','90d'],kinds:ContentKind[]=['article','project','note'],sorts:ContentSort[]=['reads','views','duration']
export function AnalyticsView(){
  const t=useTranslations('AdminMM.telemetry'),locale=useLocale(),{search,update,visible}=useTelemetryControls()
  const range=ranges.includes(search.get('range') as AnalyticsRange)?search.get('range') as AnalyticsRange:'7d'
  const kind=kinds.includes(search.get('kind') as ContentKind)?search.get('kind') as ContentKind:'article'
  const sort=sorts.includes(search.get('sort') as ContentSort)?search.get('sort') as ContentSort:'reads'
  const query=useQuery({queryKey:['telemetry-analytics',range,kind,sort],queryFn:()=>apiFetch<AnalyticsData>(`/api/admin/mm/analytics?range=${range}&kind=${kind}&sort=${sort}`),refetchInterval:visible?60000:false,retry:1})
  const data=query.data, [selected,setSelected]=useState<string|null>(null)
  const detail=useQuery({queryKey:['telemetry-content',selected,range],queryFn:()=>apiFetch<AnalyticsData>(`/api/admin/mm/analytics/content?range=${range}&key=${encodeURIComponent(selected!)}`),enabled:!!selected,retry:1})
  const labels=useMemo(()=>[t('analytics.views'),t('analytics.reads')],[t]),heatmapLabels=useMemo(()=>[t('analytics.views')],[t])
  const n=(value:number|null|undefined,decimals=0)=>numberValue(locale,value,decimals)
  const comparable=!!data&&Math.max(data.collection.epochStartedAt,data.range.end-90*86400000)<=data.range.previousStart
  const comparison=(key:'views'|'reads'|'visitors'|'averageVisibleMs')=>data?changeLabel(data.summary[key],data.previous[key],comparable,t):undefined
  const columns=[
    {title:t('content'),key:'content',render:(_:unknown,row:ContentMetric)=><button type="button" className={styles['content-button']} onClick={()=>setSelected(row.key)}><strong>{row.title}</strong>{row.projectTitle||row.version?<small>{[row.projectTitle,row.version].filter(Boolean).join(' · ')}</small>:null}</button>},
    {title:t('analytics.views'),dataIndex:'views',render:(value:number)=>n(value),sorter:(a:ContentMetric,b:ContentMetric)=>a.views-b.views,width:100},
    {title:t('analytics.reads'),dataIndex:'reads',render:(value:number)=>n(value),sorter:(a:ContentMetric,b:ContentMetric)=>a.reads-b.reads,width:120},
    {title:t('analytics.readingTime'),dataIndex:'averageVisibleMs',render:(value:number|null)=>value===null?'—':`${n(value/1000,1)}s`,sorter:(a:ContentMetric,b:ContentMetric)=>(a.averageVisibleMs||0)-(b.averageVisibleMs||0),width:130},
    {title:t('change'),key:'change',render:(_:unknown,row:ContentMetric)=><span className={styles.muted}>{changeLabel(row.reads,row.previous.reads,comparable,t)}</span>,width:170},
    {title:'',key:'open',render:(_:unknown,row:ContentMetric)=><Button size="small" onClick={()=>setSelected(row.key)}>{t('details')}</Button>,width:70},
  ]
  return <AdminPage className={styles.root}>
    <DashboardHeader mode="analytics" range={range} ranges={ranges} onRange={value=>update({range:value})} fetching={query.isFetching} refresh={()=>void query.refetch()} collection={data?.collection}/>
    {query.isError?<Failure stale={!!data} retry={()=>void query.refetch()}/>:null}
    {!data&&!query.isError?<LoadingDashboard/>:null}
    {data?<><div className={styles.metrics}>
      <Metric label={t('analytics.views')} value={n(data.summary.views)} hint={t('analytics.viewsHint')} comparison={comparison('views')}/>
      <Metric label={t(range==='today'?'analytics.visitors':'analytics.dailyVisitors')} value={n(data.summary.visitors,range==='today'?0:1)} hint={t('analytics.visitorsHint')} comparison={comparison('visitors')}/>
      <Metric label={t('analytics.reads')} value={n(data.summary.reads)} hint={t('analytics.readsHint')} comparison={comparison('reads')}/>
      <Metric label={t('analytics.readingTime')} value={n(data.summary.averageVisibleMs===null?null:data.summary.averageVisibleMs/1000,1)} unit="s" hint={t('analytics.timeHint')} comparison={comparison('averageVisibleMs')}/>
    </div>
    <Panel title={t('analytics.trend')} description={t('analytics.trendHint')}>{data.summary.views?<Chart kind="visits" points={data.trend} labels={labels} locale={locale} window={data.range} coverageStart={data.collection.epochStartedAt} summary={t('analytics.trendSummary',{views:n(data.summary.views),reads:n(data.summary.reads)})}/>:<EmptyData/>}</Panel>
    <Panel title={t('analytics.hotspots')} description={t('analytics.hotspotsHint')} actions={<div className={styles['panel-actions']}><Segmented size="small" value={kind} options={kinds.map(value=>({value,label:t(`kinds.${value}`)}))} onChange={value=>update({kind:String(value)})}/><Select size="small" aria-label={t('sort')} value={sort} options={sorts.map(value=>({value,label:t(`sorts.${value}`)}))} onChange={value=>update({sort:value})}/></div>}>
      <Table size="small" rowKey="key" dataSource={data.rankings} columns={columns} pagination={{pageSize:10,showSizeChanger:false}} scroll={{x:780}} locale={{emptyText:<EmptyData/>}}/>
    </Panel>
    <Panel title={t('analytics.heatmap')} description={t('analytics.heatmapHint')}>{data.summary.views?<Chart kind="heatmap" points={data.trend} labels={heatmapLabels} locale={locale} window={data.range} coverageStart={data.collection.epochStartedAt} summary={t('analytics.heatmapSummary')}/>:<EmptyData/>}</Panel>
    <p className={styles.footnote}>{t('analytics.boundary')}</p></>:null}
    <Drawer className={styles.drawer} open={!!selected} onClose={()=>setSelected(null)} title={detail.data?.content?.title||t('details')} size={560}>
      {detail.isError?<Alert showIcon type="error" title={t('failed')} action={<Button onClick={()=>void detail.refetch()}>{t('retry')}</Button>}/>:!detail.data?<LoadingDashboard/>:<>
        <div className={styles['detail-meta']}><Tag>{t(`kinds.${detail.data.content?.kind||kind}`)}</Tag><span>{[detail.data.content?.projectTitle,detail.data.content?.version].filter(Boolean).join(' · ')}</span>{detail.data.content?<Link href={detail.data.content.href} target="_blank" rel="noopener noreferrer">{t('openContent')} <ArrowUpRight size={13}/></Link>:null}</div>
        <div className={styles['detail-metrics']}><Metric label={t('analytics.views')} value={n(detail.data.summary.views)} hint={t('analytics.viewsHint')}/><Metric label={t('analytics.effectiveRate')} value={n(detail.data.summary.views?detail.data.summary.reads/detail.data.summary.views*100:null,1)} unit="%" hint={t('analytics.readsHint')}/><Metric label={t('analytics.reads')} value={n(detail.data.summary.reads)} hint={t('analytics.readsHint')}/><Metric label={t('analytics.readingTime')} value={n(detail.data.summary.averageVisibleMs===null?null:detail.data.summary.averageVisibleMs/1000,1)} unit="s" hint={t('analytics.timeHint')}/><Metric label={t('analytics.depth')} value={n(detail.data.summary.averageDepth,1)} unit="%" hint={t('analytics.depthHint')}/><Metric label={t('analytics.completion')} value={n(detail.data.summary.completionRate,1)} unit="%" hint={t('analytics.completionHint')}/></div>
        <Chart kind="visits" points={detail.data.trend} labels={labels} locale={locale} window={detail.data.range} coverageStart={detail.data.collection.epochStartedAt} summary={t('analytics.trendSummary',{views:n(detail.data.summary.views),reads:n(detail.data.summary.reads)})}/>
      </>}
    </Drawer>
  </AdminPage>
}
