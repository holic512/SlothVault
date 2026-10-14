/**
 * @file telemetry-reading.ts
 * @project SlothVault
 * @module Public Reading Measurement Policy
 * @description Defines an explicit public-page whitelist and bounded visible-reading measurements.
 * @logic Ignore credentials and private routes, identify content only from canonical numeric routes, and advance cumulative reading monotonically while visible.
 * @dependencies none
 * @index_tags telemetry,reading,privacy,visibility
 * @author holic512
 */
export type PublicTelemetryTarget = { page: string; type: 'page'|'article'|'project'|'note'; id?: number; projectId?: number; versionId?: number }
export function publicTelemetryTarget(pathname: string): PublicTelemetryTarget | null {
  if (['/','/articles','/project/projectList'].includes(pathname)) return { page: pathname, type:'page' }
  const article = /^\/articles\/([1-9]\d{0,9})$/.exec(pathname)
  if(article&&Number(article[1])<=2147483647) return {page:pathname,type:'article',id:Number(article[1])}
  const project = /^\/project\/([1-9]\d{0,9})\/home$/.exec(pathname)
  if(project&&Number(project[1])<=2147483647) return {page:pathname,type:'project',id:Number(project[1])}
  const note = /^\/project\/([1-9]\d{0,9})\/v\/([1-9]\d{0,9})\/docs\/([1-9]\d{0,9})$/.exec(pathname)
  if(note&&note.slice(1).every(value=>Number(value)<=2147483647)) return {page:pathname,type:'note',projectId:Number(note[1]),versionId:Number(note[2]),id:Number(note[3])}
  return null
}
export function readerDepth(top: number, height: number, viewportHeight: number) {
  if(height<=0||top>=viewportHeight||top+height<=0) return {visible:false,depth:0}
  return {visible:true,depth:Math.max(0,Math.min(100,(viewportHeight-top)/height*100))}
}
export function advanceReading(current: {visibleMs:number;depth:number},elapsed:number,visible:boolean,depth:number) {
  return {visibleMs:Math.min(30*60_000,current.visibleMs+(visible?Math.max(0,Math.min(elapsed,2000)):0)),depth:Math.max(current.depth,visible?depth:0)}
}
export function privacyDeclined(navigator: {doNotTrack?:string|null;globalPrivacyControl?:boolean}) {return navigator.doNotTrack==='1'||navigator.globalPrivacyControl===true}
export function visitorDay(now: Date) {return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)}
