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
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { listSimpleTemplates } from '@/server/commissions/simple-templates'
const input = z.object({ name: z.string().trim().min(1).max(255), key: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/) }).strict()
export const GET = defineRoute(async (request) => { await requireAdminSession(request); return apiOk(await listSimpleTemplates()) })
export const POST = defineRoute(async (request) => { await requireAdminSession(request); return apiOk(await prisma.contractTemplate.create({ data: await readJson(request, input, { maxBytes: 2000 }) }), 'created', 201) })
