/**
 * @file route.ts
 * @project SlothVault
 * @module Installation API
 * @description Returns the resumable, credential-free first-install state.
 * @logic Reconcile a completed database marker when possible and expose only provider and masked connection metadata.
 * @dependencies database/installer, server/http
 * @index_tags api,installer,status
 * @author holic512
 */
import { resolveInstallerStatus } from '@/server/database/installer'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async () => apiOk(await resolveInstallerStatus()), {
  lockMode: 'none',
})
