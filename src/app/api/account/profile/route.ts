/**
 * @file route.ts
 * @project SlothVault
 * @module Account Profile API
 * @description Reads and updates the current conventional user's non-file personal profile fields.
 * @logic Require the shared session, validate bounded profile fields, and reject avatar URLs so avatar changes use the dedicated managed-upload endpoint.
 * @dependencies zod, session service, user-auth service
 * @index_tags api,account,profile,user
 * @author holic512
 */
import { z } from 'zod'

import { requireUserSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { updateUserProfile, userDto } from '@/server/services/user-auth'

const profileSchema = z.object({
  email: z.string().trim().email().max(255).nullable().optional(),
  displayName: z.string().trim().max(80).nullable().optional(),
  bio: z.string().trim().max(2_000).nullable().optional(),
}).strict()

export const GET = defineRoute(async (request) => {
  const session = await requireUserSession(request)
  return apiOk(userDto(session.User))
})

export const PATCH = defineRoute(async (request) => {
  const session = await requireUserSession(request)
  const body = await readJson(request, profileSchema)
  return apiOk(await updateUserProfile(session.userId, body))
})
