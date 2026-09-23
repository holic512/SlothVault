/**
 * @file route.ts
 * @project SlothVault
 * @module Administrator Trash Item API
 * @description Reads deleted hierarchy nodes and previews, and restores one item with its ancestors.
 * @logic Require administrator authentication and validate kind and identifier before delegating to centralized services.
 * @dependencies admin session, HTTP helpers, trash services
 * @index_tags admin,api,trash,tree,preview,restore
 * @author holic512
 */
import { HttpError } from '@/server/http/errors'
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { parseDecimalId } from '@/server/services/admin-catalog'
import { restoreTrashItem, type TrashKind } from '@/server/services/admin-trash'
import { getTrashPreview, listTrashChildren } from '@/server/services/admin-trash-read'

export const dynamic = 'force-dynamic'

const kinds: TrashKind[] = ['article', 'project', 'version', 'category', 'note', 'content', 'home', 'menu']

function validate(kind: string, id: string) {
  if (!kinds.includes(kind as TrashKind)) throw new HttpError('Invalid trash kind', 400, 400)
  return { kind: kind as TrashKind, id: parseDecimalId(id) }
}

export const GET = defineRoute<{ kind: string; id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const params = await context.params
  const item = validate(params.kind, params.id)
  return apiOk(request.nextUrl.searchParams.get('view') === 'children'
    ? await listTrashChildren(item.kind, item.id)
    : await getTrashPreview(item.kind, item.id))
})

export const POST = defineRoute<{ kind: string; id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const params = await context.params
  const item = validate(params.kind, params.id)
  await restoreTrashItem(item.kind, item.id)
  return apiOk(null, 'restored')
})
