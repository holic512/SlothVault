/**
 * @file route.ts
 * @project SlothVault
 * @module Administrator Trash API
 * @description Lists deleted article and project roots with bounded pagination.
 * @logic Authenticate administrators and delegate filtered reads to the trash query service.
 * @dependencies admin session, HTTP response helpers, trash query service
 * @index_tags admin,api,trash,list
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { pagination } from '@/server/services/admin-catalog'
import { listTrashArticles, listTrashProjects } from '@/server/services/admin-trash-read'

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  const { page, pageSize } = pagination(request.nextUrl.searchParams)
  const keyword = (request.nextUrl.searchParams.get('keyword') || '').trim().slice(0, 120)
  const tab = request.nextUrl.searchParams.get('tab')
  if (tab === 'articles') return apiOk(await listTrashArticles(page, pageSize, keyword))
  if (tab === 'projects') return apiOk(await listTrashProjects(page, pageSize, keyword))
  throw new HttpError('Invalid trash tab', 400, 400)
})
