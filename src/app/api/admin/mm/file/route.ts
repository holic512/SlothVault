/**
 * @file route.ts
 * @project SlothVault
 * @module Admin File API
 * @description Lists file metadata and accepts bounded multipart uploads for authenticated administrators.
 * @logic Preserve legacy filters and DTOs, ignore client size overrides, validate all files before exclusive writes, and commit metadata atomically.
 * @dependencies admin session, Next Route Handlers, Prisma FileManagement model, admin file storage service
 * @index_tags api,admin,files,list,upload,multipart
 * @author holic512
 */
import type { Prisma } from '@generated/prisma/client'

import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { prisma } from '@/server/prisma'
import {
  integerValue,
  legacyBoolean,
  pagination,
  safeOrderField,
  sortDirection,
} from '@/server/services/admin-catalog'
import {
  fileDto,
  isBusinessType,
  uploadFiles,
  uploadedFileDto,
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

  const where: Prisma.FileManagementWhereInput = {}
  if (!includeDeleted) where.status = 1
  else if (Number.isFinite(status)) where.status = status
  if (keyword) where.originalName = { contains: keyword, mode: 'insensitive' }
  if (businessType) where.businessType = businessType

  const [total, list] = await Promise.all([
    prisma.fileManagement.count({ where }),
    prisma.fileManagement.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { [orderByField]: order },
    }),
  ])

  return apiOk({ list: list.map(fileDto), page, pageSize, total })
})

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const businessTypeRaw = request.nextUrl.searchParams.get('businessType') || 'Other'
  if (!isBusinessType(businessTypeRaw)) {
    throw new HttpError('Invalid businessType', 400, 400)
  }

  const records = await uploadFiles(request, { businessType: businessTypeRaw })
  return apiOk(records.map(uploadedFileDto), 'uploaded', 201)
})
