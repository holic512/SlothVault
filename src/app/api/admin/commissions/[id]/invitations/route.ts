/**
 * @file route.ts
 * @project SlothVault
 * @module Commission Workflow Route
 * @description Connects the commission workflow page or authenticated API boundary.
 * @logic Validate route inputs and delegate to the role-aware workflow service or shared page.
 * @dependencies Next.js, commission workflow modules
 * @index_tags commissions,workflow,access
 * @author holic512
 */
import { z } from 'zod'
import { defineRoute } from '@/server/http/handler'
import { readJson, parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { commissionActor } from '@/server/commissions/http'
import { createInvitation, revokeInvitation } from '@/server/commissions/invitations'
const input = z.object({ revision: z.number().int().nonnegative() }).strict()
export const POST = defineRoute<{ id: string }>(async (request, context) => apiOk(await createInvitation(parseBigIntId((await context.params).id), await commissionActor(request, true), (await readJson(request, input)).revision)))
export const DELETE = defineRoute<{ id: string }>(async (request, context) => apiOk(await revokeInvitation(parseBigIntId((await context.params).id), await commissionActor(request, true), (await readJson(request, input)).revision)))
