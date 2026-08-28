/**
 * @file route.ts
 * @project SlothVault
 * @module Article Knowledge Import API
 * @description Imports one validated article package into a selected existing draft project version.
 * @logic Require an administrator, parse the package and selected draft fields once, then append the article through the version-locked import service.
 * @dependencies admin session, HTTP route helpers, knowledge import service
 * @index_tags api, admin, knowledge-package, import, article, project-version, zip
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import {
  importArticleKnowledgePackage,
  readKnowledgeImportUpload,
} from '@/server/services/knowledge-import'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  const upload = await readKnowledgeImportUpload(request)
  return apiOk(
    await importArticleKnowledgePackage({
      parsed: upload.parsed,
      projectId: upload.fields.projectId,
      projectVersionId: upload.fields.projectVersionId,
      authorId: session.User.id,
    }),
    'imported',
    201,
  )
})
