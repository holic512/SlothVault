import { z } from 'zod'

import { hashPassword } from '@/server/auth/password'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { prisma } from '@/server/prisma'

const initSchema = z.object({
  username: z.string().trim().min(2).max(64),
  password: z.string().min(8).max(256),
})

export const POST = defineRoute(async (request) => {
  const body = await readJson(request, initSchema)
  const password = await hashPassword(body.password)

  const user = await prisma.$transaction(
    async (tx) => {
      const count = await tx.user.count()
      if (count > 0) {
        throw new HttpError('Admin already initialized', 409, 409)
      }

      return tx.user.create({
        data: { username: body.username, password },
        select: { id: true, username: true },
      })
    },
    { isolationLevel: 'Serializable' },
  )

  return apiOk(user, 'created', 201)
})
