/**
 * @file route.ts
 * @project SlothVault
 * @module Admin File API
 * @description Lists file metadata and accepts bounded multipart uploads for authenticated administrators.
 * @logic Authenticate and parse legacy list/upload inputs, then delegate metadata queries and bounded multipart persistence to the file service.
 * @dependencies admin session, Next Route Handlers, admin catalog parsing, admin file storage service
 * @index_tags api,admin,files,list,upload,multipart
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import {
  integerValue,
  legacyBoolean,
  pagination,
  safeOrderField,
  sortDirection,
} from '@/server/services/admin-catalog'
import {
  isBusinessType,
  listAdminFiles,
  uploadAdminFiles,
} from '@/server/services/admin-files'

const fileOrderFields = [
  'id',
  'originalName',
  'fileSize',
  'businessType',
  'createTime',
] as const

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  const searchParams = request.nextUrl.searchParams
  const { page, pageSize, skip } = pagination(searchParams)
  const keyword = searchParams.get('keyword')?.trim() || ''
  const businessType = searchParams.get('businessType') || undefined
  const includeDeleted = legacyBoolean(searchParams.get('includeDeleted'))
  const statusRaw = searchParams.get('status')
  const status = statusRaw === null ? undefined : integerValue(statusRaw, Number.NaN)
  const orderByField = safeOrderField(
    searchParams.get('orderBy'),
    fileOrderFields,
    'createTime',
  )
  const order = sortDirection(searchParams.get('order'))

  return apiOk(
    await listAdminFiles({
      page,
      pageSize,
      skip,
      keyword,
      businessType,
      includeDeleted,
      status,
      orderByField,
      order,
    }),
  )
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const businessTypeRaw = request.nextUrl.searchParams.get('businessType') || 'Other'
  if (!isBusinessType(businessTypeRaw)) {
    throw new HttpError('Invalid businessType', 400, 400)
  }

  return apiOk(
    await uploadAdminFiles(request, { businessType: businessTypeRaw }),
    'uploaded',
    201,
  )
})
