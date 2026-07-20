/**
 * @file route.ts
 * @project SlothVault
 * @module Installation API
 * @description Clears only a pending local database configuration before schema initialization succeeds.
 * @logic Serialize reset with initialization and refuse removal after SCHEMA_READY or INSTALLED without touching the target database.
 * @dependencies database/installer, server/http
 * @index_tags api,installer,reset,configuration
 * @author holic512
 */
import { resetPendingInstallation } from '@/server/database/installer'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'

export const POST = defineRoute(async () =>
  apiOk(await resetPendingInstallation(), 'Pending database configuration reset'),
)
