/**
 * @file route.ts
 * @project SlothVault
 * @module Administrator RPC Node Test API
 * @description Exposes authenticated, read-only tests of individual saved RPC nodes.
 * @logic Validate a fixed node key, resolve its saved endpoint, and run a bounded probe under a shared lock so node tests overlap.
 * @dependencies admin session, zod, admin-rpc service, shared maintenance lock
 * @index_tags api,admin,rpc,health,parallel,read-only
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { testAdminRpcNode } from '@/server/services/admin-rpc'
import { isRpcConfigKey, type RpcConfigKey } from '@/types/admin-rpc'

const schema = z.strictObject({ key: z.custom<RpcConfigKey>((key) => typeof key === 'string' && isRpcConfigKey(key)) })

export const dynamic = 'force-dynamic'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const { key } = await readJson(request, schema)
  return apiOk(await testAdminRpcNode(key, request.signal))
}, { lockMode: 'shared', cacheControl: 'no-store' })
