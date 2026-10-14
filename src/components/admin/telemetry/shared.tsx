'use client'
/**
 * @file shared.tsx
 * @project SlothVault
 * @module Telemetry Dashboard Interaction Primitives
 * @description Shares URL filters, visible-tab refresh, honest collection status and compact metric surfaces.
 * @logic Keep existing data during background failures, distinguish missing measurements from zero, and expose explicit sampling and coverage explanations.
 * @dependencies React, Next navigation, Ant Design, telemetry types
 * @index_tags telemetry,ui,filters,availability,accessibility
 * @author holic512
 */
import { useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Alert, Button, Segmented, Skeleton, Tag, Tooltip } from 'antd'
import { Info, RefreshCw } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import type { CollectionState } from '@/types/telemetry'
import styles from '@/styles/modules/telemetry.module.css'
export type Translator=ReturnType<typeof useTranslations<'AdminMM.telemetry'>>
export function useTelemetryControls(){
  const search=useSearchParams(),pathname=usePathname(),router=useRouter()
  const [visible,setVisible]=useState(true)
  useEffect(()=>{const update=()=>setVisible(!document.hidden);update();document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update)},[])
  const update=(values:Record<string,string|undefined>)=>{const next=new URLSearchParams(search.toString());for(const [key,value]of Object.entries(values)){if(value)next.set(key,value);else next.delete(key)}router.replace(`${pathname}?${next}`,{scroll:false})}
  return {search,update,visible}
}
export function numberValue(locale:string,value:number|null|undefined,decimals=0){return value===null||value===undefined?'—':new Intl.NumberFormat(locale,{maximumFractionDigits:decimals}).format(value)}
export function dateValue(locale:string,value:number|null){return value?new Intl.DateTimeFormat(locale,{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(value):'—'}
export function Metric({label,value,unit,hint,comparison}:{label:string;value:string;unit?:string;hint:string;comparison?:string}){return <div className={styles.metric}><div className={styles['metric-label']}>{label}<Tooltip title={hint}><Info size={13} tabIndex={0} aria-label={hint}/></Tooltip></div><strong>{value}<small>{unit}</small></strong><span>{comparison||hint}</span></div>}
export function Panel({title,description,children,actions}:{title:string;description?:string;children:ReactNode;actions?:ReactNode}){return <section className={styles.panel}><header className={styles['panel-header']}><div><h2>{title}</h2>{description?<p>{description}</p>:null}</div>{actions}</header>{children}</section>}
export function DashboardHeader({mode,range,ranges,onRange,fetching,refresh,collection}:{mode:'analytics'|'observability';range:string;ranges:string[];onRange:(value:string)=>void;fetching:boolean;refresh:()=>void;collection?:CollectionState}){
  const t=useTranslations('AdminMM.telemetry'),locale=useLocale()
  return <><header className={styles.header}><div><h1>{t(`${mode}.title`)}</h1><p>{t(`${mode}.description`)}</p></div><div className={styles.actions}><Segmented size="small" value={range} options={ranges.map(value=>({value,label:t(`ranges.${value}`)}))} onChange={value=>onRange(String(value))}/><Button size="small" icon={<RefreshCw size={13}/>} loading={fetching} onClick={refresh}>{t('refresh')}</Button></div></header><div className={styles.collection} role="status"><span className={styles['collection-left']}><Tag color={collection?.state==='healthy'?'success':collection?.state==='starting'?undefined:'warning'}>{t(`states.${collection?.state||'starting'}`)}</Tag><span>{t('instanceOnly')} · Asia/Shanghai</span></span><span>{t('updated')} {dateValue(locale,collection?.lastPersistedAt??null)}</span></div>{collection?<div className={styles.coverage}><span>{t('collectedSince')} {dateValue(locale,collection.epochStartedAt)}</span><span>{collection.incompleteSince?t('incompleteSince',{time:dateValue(locale,collection.incompleteSince)}):t('dropped',{samples:collection.droppedSamples,events:collection.droppedEvents})}</span></div>:null}</>
}
export function LoadingDashboard(){return <><div className={styles.metrics}>{[0,1,2,3].map(value=><div className={styles.metric} key={value}><Skeleton active title paragraph={{rows:1}}/></div>)}</div><Skeleton active paragraph={{rows:10}}/></>}
export function Failure({stale,retry}:{stale:boolean;retry:()=>void}){const t=useTranslations('AdminMM.telemetry');return <Alert showIcon type={stale?'warning':'error'} title={t(stale?'stale':'failed')} description={t(stale?'staleHint':'failedHint')} action={<Button size="small" onClick={retry}>{t('retry')}</Button>}/>}
export function EmptyData(){const t=useTranslations('AdminMM.telemetry');return <div className={styles.empty}><Info size={18}/><strong>{t('empty')}</strong><p>{t('emptyHint')}</p></div>}
export function changeLabel(current:number|null,previous:number|null,available:boolean,t:Translator){if(!available||previous===null||current===null)return t('noComparison');if(previous===0)return current===0?t('unchanged'):t('newActivity');const value=(current-previous)/previous*100;return `${value>0?'+':''}${value.toFixed(1)}% · ${t('previousPeriod')}`}
