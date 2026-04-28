import { batchSoftDelete } from '~~/server/utils/file'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { readBody, setResponseStatus } from 'h3'

export default defineEventHandler(async (event) => {
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  const body = await readBody<{
    action?: string
    ids?: string[]
  }>(event)

  const action = body?.action
  const ids = body?.ids

  if (!action || !Array.isArray(ids) || ids.length === 0) {
    setResponseStatus(event, 400)
    return fail('Missing action or ids', 400)
  }

  // 转换 ID
  let bigIntIds: bigint[]
  try {
    bigIntIds = ids.map((id) => BigInt(id))
  } catch {
    setResponseStatus(event, 400)
    return fail('Invalid ids', 400)
  }

  try {
    if (action === 'delete') {
      const result = await batchSoftDelete(bigIntIds)
      return ok({ affected: result.count }, 'batch deleted')
    }

    setResponseStatus(event, 400)
    return fail('Invalid action', 400)
  } catch (err) {
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
