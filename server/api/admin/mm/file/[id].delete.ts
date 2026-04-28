import { softDeleteFile, hardDeleteFile } from '~~/server/utils/file'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { getRouterParam, getQuery, setResponseStatus } from 'h3'

function toBool(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return false
  return value === '1' || value.toLowerCase() === 'true'
}

export default defineEventHandler(async (event) => {
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  const idRaw = getRouterParam(event, 'id')
  if (!idRaw) {
    setResponseStatus(event, 400)
    return fail('Missing id', 400)
  }

  let id: bigint
  try {
    id = BigInt(idRaw)
  } catch {
    setResponseStatus(event, 400)
    return fail('Invalid id', 400)
  }

  const query = getQuery(event)
  const hard = toBool(query.hard)

  try {
    if (hard) {
      await hardDeleteFile(id)
    } else {
      await softDeleteFile(id)
    }
    return ok(null, 'deleted')
  } catch (err: any) {
    if (err?.statusCode === 404) {
      setResponseStatus(event, 404)
      return fail('Not Found', 404)
    }
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
