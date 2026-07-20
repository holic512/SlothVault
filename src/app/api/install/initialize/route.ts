/**
 * @file route.ts
 * @project SlothVault
 * @module Installation API
 * @description Persists the encrypted selected connection and initializes its committed empty-database schema.
 * @logic Revalidate input, serialize installation, deploy only the fixed provider migration set, and advance to SCHEMA_READY without exposing subprocess details.
 * @dependencies database/installer, database/types, server/http
 * @index_tags api,installer,migrations,schema
 * @author holic512
 */
import { initializeEmptyDatabase } from '@/server/database/installer'
import { databaseConnectionInputSchema } from '@/server/database/types'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'

export const POST = defineRoute(async (request) => {
  const body = await readJson(request, databaseConnectionInputSchema)
  return apiOk(await initializeEmptyDatabase(body), 'Database schema initialized')
})
