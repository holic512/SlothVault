import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { getProjectNote } from '@/server/services/public-projects'

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string; versionId: string; noteId: string }>(
  async (request, context) => {
    const { id, versionId, noteId } = await context.params
    return apiOk(
      await getProjectNote(
        request,
        parseBigIntId(id, 'project id'),
        parseBigIntId(versionId, 'version id'),
        parseBigIntId(noteId, 'note id'),
      ),
    )
  },
)
