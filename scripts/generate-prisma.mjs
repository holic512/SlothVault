/**
 * @file scripts/generate-prisma.mjs
 * @project SlothVault
 * @module Multi-provider Prisma client generation
 * @description Generates or validates all committed PostgreSQL, MySQL, and SQLite Prisma schemas with the locally installed Prisma CLI.
 * @logic Iterate a fixed provider/schema mapping, run the requested safe Prisma command, and fail the aggregate operation on the first provider error.
 * @dependencies prisma CLI, prisma/providers
 * @index_tags prisma, codegen, schema-validation, postgresql, mysql, sqlite
 * @author holic512
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const prismaPackage = require.resolve('prisma/package.json')
const prismaCli = resolve(dirname(prismaPackage), 'build/index.js')
const action = process.argv.includes('--validate') ? 'validate' : 'generate'
const providers = [
  ['postgresql', 'prisma/providers/postgresql/schema.prisma'],
  ['mysql', 'prisma/providers/mysql/schema.prisma'],
  ['sqlite', 'prisma/providers/sqlite/schema.prisma'],
]

for (const [provider, schema] of providers) {
  const result = spawnSync(process.execPath, [prismaCli, action, '--schema', schema], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SLOTHVAULT_PRISMA_PROVIDER: provider,
    },
    stdio: 'inherit',
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
