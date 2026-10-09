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
import { publicWorkflowEvidence } from '@/server/commissions/evidence'
export const GET = defineRoute<{ signature: string }>(async (_request, context) => apiOk(await publicWorkflowEvidence((await context.params).signature)))
