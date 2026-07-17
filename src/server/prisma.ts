/**
 * @file prisma.ts
 * @project SlothVault
 * @module Database
 * @description Creates the single Prisma 7 PostgreSQL client shared by Next.js server routes and services.
 * @logic Build the driver adapter from DATABASE_URL and reuse the client during development hot reloads.
 * @dependencies @prisma/adapter-pg, generated/prisma/client
 * @index_tags prisma,postgresql,database,singleton
 * @author holic512
 */
import 'server-only'

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@generated/prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required')
  }

  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
