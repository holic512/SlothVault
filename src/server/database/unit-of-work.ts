/**
 * @file unit-of-work.ts
 * @project SlothVault
 * @module Database Runtime
 * @description Provides provider-neutral transaction boundaries and the supported SQLite process write mutex.
 * @logic Execute interactive Prisma transactions directly for server databases, queue SQLite writes within its single process, and expose one transaction client to repository/service operations.
 * @dependencies generated Prisma transaction types, database/client, database/config-store
 * @index_tags database,unit-of-work,transaction,sqlite,mutex
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { getDatabaseClient } from '@/server/database/client'
import { configuredDatabaseProvider } from '@/server/database/client'

export type UnitOfWorkOptions = {
  isolationLevel?: Prisma.TransactionIsolationLevel
  maxWait?: number
  timeout?: number
  mode?: 'read' | 'write'
}

const globalForUnitOfWork = globalThis as unknown as {
  slothVaultSqliteWriteQueue?: Promise<void>
}

async function withSqliteWriteMutex<T>(operation: () => Promise<T>) {
  const previous = globalForUnitOfWork.slothVaultSqliteWriteQueue ?? Promise.resolve()
  let releaseQueue: (() => void) | undefined
  const current = new Promise<void>((resolveQueue) => {
    releaseQueue = resolveQueue
  })
  const tail = previous.then(() => current)
  globalForUnitOfWork.slothVaultSqliteWriteQueue = tail
  await previous

  try {
    return await operation()
  } finally {
    releaseQueue?.()
    if (globalForUnitOfWork.slothVaultSqliteWriteQueue === tail) {
      globalForUnitOfWork.slothVaultSqliteWriteQueue = undefined
    }
  }
}

export class UnitOfWork {
  execute<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
    options: UnitOfWorkOptions = {},
  ) {
    const run = () => getDatabaseClient().$transaction(operation, {
      ...(options.isolationLevel ? { isolationLevel: options.isolationLevel } : {}),
      ...(options.maxWait !== undefined ? { maxWait: options.maxWait } : {}),
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
    })
    if (options.mode !== 'read' && configuredDatabaseProvider() === 'sqlite') {
      return withSqliteWriteMutex(run)
    }
    return run()
  }
}

export const unitOfWork = new UnitOfWork()
