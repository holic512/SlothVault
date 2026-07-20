/**
 * @file prisma.config.ts
 * @project SlothVault
 * @module Multi-provider Prisma CLI configuration
 * @description Selects one committed provider schema and migration directory without accepting user-controlled filesystem paths.
 * @logic Validate the internal provider identifier, resolve its fixed schema/migration pair, and inject a datasource URL only when the installer supplies one.
 * @dependencies prisma/config, prisma/providers
 * @index_tags prisma, database, postgresql, mysql, sqlite, migrations
 * @author holic512
 */
import { defineConfig } from 'prisma/config'

if (process.env.NODE_ENV !== 'production') {
  await import('dotenv/config')
}

const providerConfigs = {
  postgresql: {
    schema: 'prisma/providers/postgresql/schema.prisma',
    migrations: 'prisma/providers/postgresql/migrations',
  },
  mysql: {
    schema: 'prisma/providers/mysql/schema.prisma',
    migrations: 'prisma/providers/mysql/migrations',
  },
  sqlite: {
    schema: 'prisma/providers/sqlite/schema.prisma',
    migrations: 'prisma/providers/sqlite/migrations',
  },
} as const

type DatabaseProvider = keyof typeof providerConfigs

const requestedProvider = process.env.SLOTHVAULT_PRISMA_PROVIDER?.trim() || 'postgresql'

if (!Object.hasOwn(providerConfigs, requestedProvider)) {
  throw new Error(`Unsupported SLOTHVAULT_PRISMA_PROVIDER: ${requestedProvider}`)
}

const provider = requestedProvider as DatabaseProvider
const selected = providerConfigs[provider]
const databaseUrl = process.env.SLOTHVAULT_PRISMA_DATABASE_URL?.trim()
const baseConfig = {
  schema: selected.schema,
  migrations: {
    path: selected.migrations,
  },
}

export default databaseUrl
  ? defineConfig({
      ...baseConfig,
      datasource: { url: databaseUrl },
    })
  : defineConfig(baseConfig)
