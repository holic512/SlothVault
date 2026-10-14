'use client'
/**
 * @file public-telemetry.tsx
 * @project SlothVault
 * @module Public Telemetry Reporter
 * @description Reports actual public mounts and visible authorized reading without blocking navigation.
 * @logic Keep one view ID across Strict Mode replay, pause hidden or offscreen reading, rotate anonymous IDs daily, and submit cumulative best-effort beacons.
 * @dependencies next/navigation, telemetry-reading, browser visibility/sendBeacon
 * @index_tags telemetry,analytics,reading,privacy,beacon
 * @author holic512
 */
import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { advanceReading, privacyDeclined, publicTelemetryTarget, readerDepth, visitorDay } from '@/lib/telemetry-reading'

function anonymousVisitor() {
  try {
    const key='sv-telemetry-visitor', day=visitorDay(new Date()), stored=JSON.parse(localStorage.getItem(key)||'null') as {day:string;id:string}|null
    if(stored?.day===day&&/^[a-f0-9-]{36}$/.test(stored.id)) return stored.id
    const id=crypto.randomUUID();localStorage.setItem(key,JSON.stringify({day,id}));return id
  } catch {return null}
}
export function PublicTelemetry() {
  const pathname=usePathname()
  const view=useRef<{page:string;id:string;visibleMs:number;depth:number}|null>(null)
  useEffect(()=>{
    const target=publicTelemetryTarget(pathname)
    if(!target||privacyDeclined(navigator as Navigator & {globalPrivacyControl?:boolean})) return
    if(view.current?.page!==pathname) view.current={page:pathname,id:crypto.randomUUID(),visibleMs:0,depth:0}
    const current=view.current!, controller=new AbortController()
    let previous=performance.now()
    const measure=()=>{
      const now=performance.now(), elapsed=now-previous;previous=now
      const reader=document.querySelector<HTMLElement>('[data-telemetry-reader="true"]')
      const rect=reader?.getBoundingClientRect(), position=rect?readerDepth(rect.top,rect.height,window.innerHeight):{visible:false,depth:0}
      Object.assign(current,advanceReading(current,elapsed,!document.hidden&&position.visible,position.depth))
    }
    const send=(leaving=false)=>{
      if(privacyDeclined(navigator as Navigator & {globalPrivacyControl?:boolean})) return
      const body=JSON.stringify({id:current.id,page:target.page,visitorId:anonymousVisitor(),visibleMs:Math.round(current.visibleMs),depth:Math.round(current.depth)})
      try {
        if(leaving&&navigator.sendBeacon('/api/telemetry/events',new Blob([body],{type:'application/json'}))) return
        void fetch('/api/telemetry/events',{method:'POST',body,headers:{'Content-Type':'application/json'},credentials:'same-origin',keepalive:leaving,signal:leaving?undefined:controller.signal}).catch(()=>undefined)
      } catch {/* Measurement must never break navigation. */}
    }
    send()
    const measureTimer=setInterval(measure,1000), reportTimer=setInterval(()=>{measure();if(!document.hidden)send()},10000)
    const visibility=()=>{measure();send(document.hidden);previous=performance.now()}
    const pagehide=()=>{measure();send(true)}
    document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',pagehide)
    return ()=>{measure();send(true);clearInterval(measureTimer);clearInterval(reportTimer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pagehide);controller.abort()}
  },[pathname])
  return null
}
