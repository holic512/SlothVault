/**
 * @file route.ts
 * @project SlothVault
 * @module Private Commission API
 * @description Provides authenticated commission lifecycle or protected artifact access.
 * @logic Bind the session actor, validate the owned commission, and delegate to transactional domain services.
 * @dependencies commission services, authentication, HTTP adapters
 * @index_tags api,commissions,privacy,lifecycle
 * @author holic512
 */
import { z } from 'zod'
import { prisma } from '@/server/prisma'
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson, parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
export const PUT = defineRoute<{ id: string }>(async (request, context) => { await requireAdminSession(request); const body = await readJson(request, z.object({ status: z.enum(['ACTIVE', 'RETIRED']) }).strict()); return apiOk(await prisma.contractTemplate.update({ where: { id: parseBigIntId((await context.params).id) }, data: body })) })
