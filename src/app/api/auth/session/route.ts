/**
 * @file route.ts
 * @project SlothVault
 * @module User Session API
 * @description Returns the active conventional account represented by the shared session cookie, or null for an anonymous visitor.
 * @logic Read the optional session without turning public navigation into a 401 request and expose only the stable account DTO.
 * @dependencies session service, user-auth DTO
 * @index_tags api,user,session,profile
 * @author holic512
 */
import { readSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { userDto } from '@/server/services/user-auth'

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  const session = await readSession(request)
  return apiOk(session ? userDto(session.User) : null)
})
