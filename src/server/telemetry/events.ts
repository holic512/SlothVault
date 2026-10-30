/**
 * @file events.ts
 * @project SlothVault
 * @module Telemetry Ingestion
 * @description Validates public visibility, current reading authorization and bounded anonymous events before enqueueing.
 * @logic Accept canonical same-origin events, limit ephemeral IP digests, resolve authoritative metadata without loading Markdown, and strip reading metrics when authorization is absent.
 * @dependencies zod, public metadata/access services, isolated telemetry quotas, master-key, telemetry runtime
 * @index_tags telemetry,ingestion,privacy,authorization,rate-limit
 * @author holic512
 */
import 'server-only'
import { resolvePublicArticleId, resolvePublicProjectIds } from '@/server/services/public-content-ids'
import { createHmac } from 'node:crypto'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import { publicTelemetryTarget, visitorDay } from '@/lib/telemetry-reading'
import { getRequestViewer } from '@/server/auth/viewer'
import { getMasterKey } from '@/server/config/master-key'
import { HttpError } from '@/server/http/errors'
import { readJson, requestClientIp } from '@/server/http/request'
import { telemetryRateLimit } from './rate-limit'
import { getPublicArticleMetadata } from '@/server/services/public-articles'
import { getPublicProject, getProjectNoteMetadata, getProjectVersions } from '@/server/services/public-projects'
import { resolveArticleAccess, resolveProjectAccess } from '@/server/services/content-access'
import { prisma } from '@/server/prisma'
import { telemetryRuntime } from './runtime'
import type { TrustedPageEvent } from '@/types/telemetry'

const schema=z.object({id:z.string().uuid(),page:z.string().max(180),visitorId:z.string().uuid().nullable(),visibleMs:z.number().int().min(0).max(1800000),depth:z.number().min(0).max(100)}).strict()
function digest(scope:string,value:string){return createHmac('sha256',getMasterKey()).update(`telemetry:${scope}:${value}`).digest('hex')}
export { isSameOriginRequest as isSameOriginTelemetry } from '@/server/http/same-origin'
import { isSameOriginRequest as isSameOriginTelemetry } from '@/server/http/same-origin'

export async function ingestTelemetry(request:NextRequest) {
  if(!isSameOriginTelemetry(request)) throw new HttpError('Cross-origin telemetry is not allowed',403,403)
  if(request.headers.get('dnt')==='1'||request.headers.get('sec-gpc')==='1') return {accepted:false,reason:'PRIVACY_PREFERENCE'}
  const input=await readJson(request,schema,{maxBytes:2048}),target=publicTelemetryTarget(input.page)
  if(!target) throw new HttpError('Unsupported telemetry page',400,400)
  telemetryRateLimit(`ip:${digest('limit',requestClientIp(request))}`,1200)
  telemetryRateLimit(`view:${input.id}`,12)
  const event:TrustedPageEvent={id:input.id,timestamp:Date.now(),key:`page:${target.page}`,visitorHash:input.visitorId?digest(`visitor:${visitorDay(new Date())}`,input.visitorId):null,visibleMs:0,depth:0}
  if(target.type!=='page') {
    const viewer=await getRequestViewer(request)
    if(target.type==='article') {
      const articleId = await resolvePublicArticleId(target.id!)
      const [metadata,allowed]=await Promise.all([getPublicArticleMetadata(articleId),resolveArticleAccess(articleId,viewer)])
      event.key=`article:${articleId}`
      event.content={key:event.key,kind:'article',title:metadata.title,href:target.page}
      if(allowed){event.visibleMs=input.visibleMs;event.depth=input.depth}
    } else {
      const resolved = await resolvePublicProjectIds({ id: target.type==='project' ? target.id! : target.projectId!, ...(target.type==='note' ? { versionId: target.versionId, noteId: target.id } : {}) })
      const { projectId } = resolved
      const [project,access,versions]=await Promise.all([getPublicProject(projectId),resolveProjectAccess(projectId,viewer),getProjectVersions(projectId)])
      if(!versions.length) throw new HttpError('No published version',404,404)
      event.key=`project:${projectId}`
      event.content={key:event.key,kind:'project',title:project.projectName,href:target.page}
      if(target.type==='note') {
        const note=await getProjectNoteMetadata(projectId,resolved.versionId!,resolved.noteId!),version=versions.find(item=>item.id===target.versionId)
        if(!version) throw new HttpError('Version is not published',404,404)
        event.key=`note:${projectId}:${resolved.versionId}:${resolved.noteId}`
        event.content={key:event.key,kind:'note',title:note.noteTitle,href:target.page,projectKey:`project:${projectId}`,projectTitle:project.projectName,version:version.version}
      } else if(!await prisma.projectHome.findFirst({where:{projectId,status:1,isDeleted:false},select:{id:true}})) throw new HttpError('Homepage not found',404,404)
      if(access.canRead){event.visibleMs=input.visibleMs;event.depth=input.depth}
    }
  }
  const runtime=telemetryRuntime()
  return {accepted:runtime?.page(event)??false}
}
