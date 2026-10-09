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
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { commissionActor } from '@/server/commissions/http'
import { claimInvitation, inspectInvitation } from '@/server/commissions/invitations'
export const GET = defineRoute<{ token: string }>(async (_request, context) => apiOk(await inspectInvitation((await context.params).token)))
export const POST = defineRoute<{ token: string }>(async (request, context) => apiOk(await claimInvitation((await context.params).token, await commissionActor(request, false))))
