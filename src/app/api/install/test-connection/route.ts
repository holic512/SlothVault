/**
 * @file route.ts
 * @project SlothVault
 * @module Installation API
 * @description Tests a selected PostgreSQL, MySQL, or managed SQLite target before initialization.
 * @logic Validate the discriminated provider payload, require a strictly empty database on first test, and never persist or echo credentials.
 * @dependencies database/connection-test, database/config-store, server/http
 * @index_tags api,installer,database,connection-test
 * @author holic512
 */
import { readDatabaseConfiguration } from '@/server/database/config-store'
import {
  inspectPendingDatabaseConnection,
  testEmptyDatabaseConnection,
} from '@/server/database/connection-test'
import { databaseConnectionInputSchema } from '@/server/database/types'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'

export const POST = defineRoute(async (request) => {
  const body = await readJson(request, databaseConnectionInputSchema)
  const existing = readDatabaseConfiguration()
  if (existing?.status === 'INSTALLED' || existing?.status === 'SCHEMA_READY') {
    throw new HttpError('Database provider is already fixed', 409, 409)
  }
  if (existing?.status === 'CONFIGURING') {
    return apiOk({
      ...await inspectPendingDatabaseConnection(existing.connection),
      resuming: true,
    })
  }
  return apiOk(await testEmptyDatabaseConnection(body))
})
