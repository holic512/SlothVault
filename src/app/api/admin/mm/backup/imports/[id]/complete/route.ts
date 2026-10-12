/**
 * @file route.ts
 * @project SlothVault
 * @module Backup Upload Completion API
 * @description Promotes a fully acknowledged upload into an immutable restore source.
 * @logic Authenticate, verify the durable byte count, and atomically publish the uploaded artifact.
 * @dependencies administrator session, resumable upload store, route error boundary
 * @index_tags api,backup,upload,complete,atomic
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { completeBackupUpload } from '@/server/services/admin-backup/uploads'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const POST = defineRoute<{id:string}>(async(request,context)=>{
  const session=await requireAdminSession(request)
  return apiOk(await completeBackupUpload((await context.params).id,session.userId))
},{lockMode:'none',cacheControl:'no-store'})
