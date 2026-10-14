'use client'
/**
 * @file telemetry-chart.tsx
 * @project SlothVault
 * @module Telemetry Visualization
 * @description Renders restrained, theme-aware SVG trends and hourly visitor heatmaps.
 * @logic Keep request rate and latency on separate axes, expose toggleable legends and textual summaries, resize with the container, and dispose charts on unmount.
 * @dependencies ECharts core/charts/components, React, SlothVault theme tokens
 * @index_tags telemetry,chart,svg,theme,accessibility,heatmap
 * @author holic512
 */
import { useEffect, useRef } from 'react'
import { LineChart, HeatmapChart } from 'echarts/charts'
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { init, use as register, type EChartsCoreOption } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import styles from '@/styles/modules/telemetry.module.css'
register([LineChart,HeatmapChart,AriaComponent,GridComponent,LegendComponent,TooltipComponent,VisualMapComponent,SVGRenderer])
type Point={timestamp:number;views?:number;reads?:number;count?:number;averageMs?:number|null;p95Ms?:number|null}
export default function TelemetryChart({kind,points,labels,locale,summary,window,coverageStart}:{kind:'visits'|'requests'|'latency'|'heatmap';points:Point[];labels:string[];locale:string;summary:string;window:{start:number;end:number};coverageStart:number}) {
  const ref=useRef<HTMLDivElement>(null),heatmap=kind==='heatmap'
  const first=Math.max(window.start,coverageStart),hours=Math.ceil((window.end-first)/3600000)
  const height=heatmap?Math.max(280,Math.ceil(hours/24)*16+80):250
  useEffect(()=>{
    const element=ref.current;if(!element)return
    const chart=init(element,undefined,{renderer:'svg'})
    const format=new Intl.DateTimeFormat(locale,{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'})
    const draw=()=>{
      const css=getComputedStyle(element),primary=css.getPropertyValue('--sv-primary').trim(),muted=css.getPropertyValue('--sv-text-muted').trim(),border=css.getPropertyValue('--sv-border').trim(),soft=css.getPropertyValue('--sv-bg-soft').trim(),secondary=css.getPropertyValue(kind==='latency'?'--sv-text-muted':'--sv-success').trim()
      const byTime=new Map(points.map(point=>[point.timestamp,point]))
      const unit=kind==='visits'||heatmap?3600000:window.end-window.start>86400000?3600000:window.end-window.start>3600000?900000:60000
      const complete:Point[]=[]
      for(let ts=Math.floor(window.start/unit)*unit;ts<window.end;ts+=unit){const point=byTime.get(ts);complete.push(point??{timestamp:ts,views:ts>=coverageStart?0:undefined,reads:ts>=coverageStart?0:undefined,count:ts>=coverageStart?0:undefined,averageMs:null,p95Ms:null})}
      const option:EChartsCoreOption={animation:false,textStyle:{fontFamily:css.fontFamily,color:muted},color:[primary,secondary],aria:{enabled:true,label:{description:summary}},tooltip:{trigger:heatmap?'item':'axis',confine:true,renderMode:'richText'},grid:{left:12,right:16,top:40,bottom:32,outerBoundsMode:'same'}}
      if(heatmap){
        const days=[...new Set(complete.filter(point=>point.timestamp>=Math.floor(first/3600000)*3600000).map(point=>dayFormat.format(point.timestamp)))]
        const data=complete.filter(point=>point.timestamp>=Math.floor(first/3600000)*3600000).map(point=>[(new Date(point.timestamp).getUTCHours()+8)%24,days.indexOf(dayFormat.format(point.timestamp)),point.views??0])
        Object.assign(option,{grid:{left:60,right:12,top:8,bottom:45},xAxis:{type:'category',data:Array.from({length:24},(_,i)=>`${i}:00`),axisLine:{show:false},axisTick:{show:false},axisLabel:{color:muted,interval:2}},yAxis:{type:'category',data:days,axisLine:{show:false},axisTick:{show:false},axisLabel:{color:muted}},visualMap:{min:0,max:Math.max(1,...data.map(item=>item[2])),orient:'horizontal',left:'center',bottom:0,itemWidth:10,itemHeight:100,inRange:{color:[soft,primary]},textStyle:{color:muted}},tooltip:{confine:true,renderMode:'richText',formatter:(params:unknown)=>{const value=(params as {value:number[]}).value;return `${days[value[1]]} ${value[0]}:00\n${labels[0]}: ${value[2]}`}},series:[{type:'heatmap',data,itemStyle:{borderWidth:2,borderColor:css.getPropertyValue('--sv-bg-solid').trim()},emphasis:{itemStyle:{borderColor:primary,borderWidth:2}}}]})
      }else{
        const fields=kind==='visits'?['views','reads'] as const:kind==='latency'?['averageMs','p95Ms'] as const:['count'] as const
        Object.assign(option,{legend:{top:0,left:8,textStyle:{color:muted},itemWidth:16,itemHeight:6,icon:'roundRect'},xAxis:{type:'time',axisLine:{lineStyle:{color:border}},axisTick:{show:false},splitLine:{show:false},axisLabel:{color:muted,hideOverlap:true,formatter:(value:number)=>format.format(value)}},yAxis:{type:'value',min:0,name:kind==='latency'?'ms':'',minInterval:kind==='visits'?1:undefined,axisLabel:{color:muted},splitLine:{lineStyle:{color:border,type:'dashed'}}},series:fields.map((field,index)=>({name:labels[index],type:'line',data:complete.map(point=>[point.timestamp,point[field]===undefined||point[field]===null?null:kind==='requests'?point[field]!/(Math.max(1,Math.min(unit,window.end-point.timestamp))/1000):point[field]]),showSymbol:complete.length<20,symbolSize:4,lineStyle:{width:2,type:index===1&&kind==='latency'?'dashed':'solid'},areaStyle:index===0?{opacity:.035}:undefined,connectNulls:false}))})
      }
      chart.setOption(option,{notMerge:true})
    }
    draw();const resize=new ResizeObserver(()=>chart.resize());resize.observe(element)
    const observer=new MutationObserver(draw);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-style','class','style']})
    return()=>{resize.disconnect();observer.disconnect();chart.dispose()}
  },[kind,points,labels,locale,summary,window,coverageStart,first,heatmap])
  return <div className={heatmap?styles['heatmap-scroll']:undefined}><div ref={ref} role="img" aria-label={summary} style={{height}}/><p className={styles['chart-summary']}>{summary}</p></div>
}
