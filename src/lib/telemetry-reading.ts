/**
 * @file telemetry-reading.ts
 * @project SlothVault
 * @module Public Reading Measurement Policy
 * @description Defines an explicit public-page whitelist and bounded visible-reading measurements.
 * @logic Ignore credentials and private routes, identify content only from canonical opaque routes, and advance cumulative reading monotonically while visible.
 * @dependencies none
 * @index_tags telemetry,reading,privacy,visibility
 * @author holic512
 */
import { PUBLIC_CONTENT_ID_PATTERN } from './public-content-id'
export type PublicTelemetryTarget = { page: string; type: 'page'|'article'|'project'|'note'; id?: string; projectId?: string; versionId?: string }
export function publicTelemetryTarget(pathname: string): PublicTelemetryTarget | null {
  if (['/','/articles','/project/projectList'].includes(pathname)) return { page: pathname, type:'page' }
  const article = new RegExp(`^/articles/(${PUBLIC_CONTENT_ID_PATTERN})$`).exec(pathname)
  if (article) return {page:pathname,type:'article',id:article[1]}
  const project = new RegExp(`^/project/(${PUBLIC_CONTENT_ID_PATTERN})/home$`).exec(pathname)
  if (project) return {page:pathname,type:'project',id:project[1]}
  const note = new RegExp(`^/project/(${PUBLIC_CONTENT_ID_PATTERN})/v/(${PUBLIC_CONTENT_ID_PATTERN})/docs/(${PUBLIC_CONTENT_ID_PATTERN})$`).exec(pathname)
  if (note) return {page:pathname,type:'note',projectId:note[1],versionId:note[2],id:note[3]}
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
