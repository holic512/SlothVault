/**
 * @file prisma.ts
 * @project SlothVault
 * @module Database
 * @description Exposes the installed provider's lazy Prisma client through the shared server import boundary.
 * @logic Defer encrypted configuration loading and provider selection until a database property is first accessed, then bind methods to the shared runtime client.
 * @dependencies server/database/client, generated/prisma-postgresql/client
 * @index_tags prisma,database,lazy-client
 * @author holic512
 */
import 'server-only'

import type { AppPrismaClient } from '@/server/database/client'
import { getDatabaseClient } from '@/server/database/client'

export const prisma = new Proxy({} as AppPrismaClient, {
  get(_target, property) {
    const client = getDatabaseClient()
    const value = Reflect.get(client, property, client) as unknown
    return typeof value === 'function' ? value.bind(client) : value
  },
})
