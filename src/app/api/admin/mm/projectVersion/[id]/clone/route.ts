/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Version Clone API
 * @description Clones a frozen published version into an editable draft.
 * @logic Authenticate, validate the new label and optional overrides, then clone the complete undeleted document history inside one transaction.
 * @dependencies Zod, admin session, HTTP route helpers, project-version release service
 * @index_tags api,admin,project-version,clone,draft
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { parseDecimalId } from '@/server/services/admin-catalog'
import { cloneProjectVersion } from '@/server/services/project-version-release'

const cloneSchema = z.object({
  version: z.string().trim().min(1).max(64),
  description: z.string().nullable().optional(),
  weight: z.number().int().optional(),
}).strict()

export const dynamic = 'force-dynamic'

export const POST = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const { id } = await context.params
  const body = await readJson(request, cloneSchema)
  return apiOk(await cloneProjectVersion(parseDecimalId(id), body), 'created', 201)
})
