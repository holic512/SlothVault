/**
 * @file route.ts
 * @project SlothVault
 * @module Backup Upload Session API
 * @description Queries, appends to, and cancels administrator-owned resumable uploads.
 * @logic Authenticate every request, serialize per-session chunk commits, and leave business state unlocked during transfer.
 * @dependencies administrator session, resumable upload store, route error boundary
 * @index_tags api,backup,upload,chunks,resume
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { getBackupUpload, appendBackupUpload, cancelBackupUpload } from '@/server/services/admin-backup/uploads'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const GET = defineRoute<{id:string}>(async (request,context) => {
  const session = await requireAdminSession(request)
  return apiOk(await getBackupUpload((await context.params).id,session.userId))
},{lockMode:'none',cacheControl:'no-store'})
export const PATCH = defineRoute<{id:string}>(async (request,context) => {
  const session = await requireAdminSession(request)
  return apiOk(await appendBackupUpload((await context.params).id,session.userId,request))
},{lockMode:'none',cacheControl:'no-store'})
export const DELETE = defineRoute<{id:string}>(async (request,context) => {
  const session = await requireAdminSession(request)
  await cancelBackupUpload((await context.params).id,session.userId)
  return apiOk({cancelled:true})
},{lockMode:'none',cacheControl:'no-store'})
