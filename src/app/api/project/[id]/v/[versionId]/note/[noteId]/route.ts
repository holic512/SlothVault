/**
 * @file route.ts
 * @project SlothVault
 * @module Project Document API
 * @description Serves visible published document bodies to viewers with current project reading permission.
 * @logic Resolve session identity, check visibility and membership before selecting Markdown, and apply private caching to GET and HEAD.
 * @dependencies viewer, public-projects, HTTP route helpers
 * @index_tags project,document,api,read,head,membership,private-cache
 * @author holic512
 */
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { getProjectNote } from '@/server/services/public-projects'
import { getRequestViewer } from '@/server/auth/viewer'

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string; versionId: string; noteId: string }>(
  async (request, context) => {
    const { id, versionId, noteId } = await context.params
    const response = apiOk(
      await getProjectNote(
        parseBigIntId(id, 'project id'),
        parseBigIntId(versionId, 'version id'),
        parseBigIntId(noteId, 'note id'),
        await getRequestViewer(request),
      ),
    )
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  },
  { cacheControl: 'private, no-store' },
)

export async function HEAD(request: Parameters<typeof GET>[0], context: Parameters<typeof GET>[1]) {
  const response = await GET(request, context)
  return new Response(null, { status: response.status, headers: response.headers })
}
