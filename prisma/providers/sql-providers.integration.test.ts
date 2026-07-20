import { randomUUID } from 'node:crypto'

import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaPg } from '@prisma/adapter-pg'
import { describe, expect, it } from 'vitest'

import { PrismaClient as MySqlPrismaClient } from '../../generated/prisma-mysql/client'
import { PrismaClient as PostgresPrismaClient } from '../../generated/prisma-postgresql/client'

const postgresUrl = process.env.TEST_POSTGRES_DATABASE_URL
const mysqlUrl = process.env.TEST_MYSQL_DATABASE_URL
const runSqlProviders = process.env.RUN_MULTI_PROVIDER_SQL_SMOKE === '1'

describe.runIf(runSqlProviders && Boolean(postgresUrl))('PostgreSQL provider integration', () => {
  it('uses the generated client for install state, seeded locks, and portable Int IDs', async () => {
    const prisma = new PostgresPrismaClient({
      adapter: new PrismaPg({ connectionString: postgresUrl }),
    })
    const installationId = randomUUID()

    try {
      expect(await prisma.runtimeLock.count()).toBe(2)
      const installation = await prisma.systemInstallation.create({
        data: {
          id: 1,
          installationId,
          provider: 'postgresql',
          status: 'SCHEMA_READY',
          schemaRevision: 1,
        },
      })
      expect(installation.installationId).toBe(installationId)

      const user = await prisma.user.create({
        data: { username: `postgres-${installationId}`, password: 'test-only' },
      })
      expect(user.id).toBeTypeOf('number')

      await prisma.systemInstallation.update({
        where: { id: 1 },
        data: { status: 'INSTALLED', installedAt: new Date() },
      })
      expect((await prisma.systemInstallation.findUniqueOrThrow({ where: { id: 1 } })).status).toBe(
        'INSTALLED',
      )
    } finally {
      await prisma.user.deleteMany({ where: { username: `postgres-${installationId}` } })
      await prisma.systemInstallation.deleteMany({ where: { installationId } })
      await prisma.$disconnect()
    }
  })
})

describe.runIf(runSqlProviders && Boolean(mysqlUrl))('MySQL provider integration', () => {
  it('uses the generated client for install state, seeded locks, and portable Int IDs', async () => {
    const prisma = new MySqlPrismaClient({ adapter: new PrismaMariaDb(mysqlUrl!) })
    const installationId = randomUUID()

    try {
      expect(await prisma.runtimeLock.count()).toBe(2)
      const installation = await prisma.systemInstallation.create({
        data: {
          id: 1,
          installationId,
          provider: 'mysql',
          status: 'SCHEMA_READY',
          schemaRevision: 1,
        },
      })
      expect(installation.installationId).toBe(installationId)

      const user = await prisma.user.create({
        data: { username: `mysql-${installationId}`, password: 'test-only' },
      })
      expect(user.id).toBeTypeOf('number')

      await prisma.systemInstallation.update({
        where: { id: 1 },
        data: { status: 'INSTALLED', installedAt: new Date() },
      })
      expect((await prisma.systemInstallation.findUniqueOrThrow({ where: { id: 1 } })).status).toBe(
        'INSTALLED',
      )
    } finally {
      await prisma.user.deleteMany({ where: { username: `mysql-${installationId}` } })
      await prisma.systemInstallation.deleteMany({ where: { installationId } })
      await prisma.$disconnect()
    }
  })
})
