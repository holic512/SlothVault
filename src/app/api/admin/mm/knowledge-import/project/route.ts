/**
 * @file route.ts
 * @project SlothVault
 * @module Project Knowledge Import API
 * @description Imports one validated project knowledge package as a newly created draft version beneath an existing project.
 * @logic Require an administrator, parse the package and target multipart fields once, then delegate the all-or-nothing version-tree creation to the import service.
 * @dependencies admin session, HTTP route helpers, knowledge import service
 * @index_tags api, admin, knowledge-package, import, project-version, zip
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import {
  importProjectKnowledgePackage,
  readKnowledgeImportUpload,
} from '@/server/services/knowledge-import'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  const upload = await readKnowledgeImportUpload(request)
  return apiOk(
    await importProjectKnowledgePackage({
      parsed: upload.parsed,
      projectId: upload.fields.projectId,
      version: upload.fields.version,
      authorId: session.User.id,
    }),
    'imported',
    201,
  )
})
