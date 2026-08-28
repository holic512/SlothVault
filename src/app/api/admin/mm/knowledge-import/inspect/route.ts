/**
 * @file route.ts
 * @project SlothVault
 * @module Knowledge Package Inspection API
 * @description Preflights one Skill-produced knowledge ZIP and returns only its validated, non-content import summary.
 * @logic Require an administrator, parse one bounded multipart archive through the shared package validator, and expose the import kind, catalog shape, and provenance counts before any database write.
 * @dependencies admin session, HTTP route helpers, knowledge import service
 * @index_tags api, admin, knowledge-package, import, inspect, zip
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import {
  knowledgePackagePreview,
  readKnowledgeImportUpload,
} from '@/server/services/knowledge-import'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const upload = await readKnowledgeImportUpload(request)
  return apiOk(knowledgePackagePreview(upload.parsed))
})
