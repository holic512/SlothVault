import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { promisify } from 'node:util'
import mariadb from 'mariadb'
import { describe, expect, it } from 'vitest'

const databaseUrl = process.env.SLOTHVAULT_PLUGIN_TEST_MYSQL_URL
const repair = '20260819000000_release_credential_fk_support'
const run = promisify(execFile)

describe.skipIf(!databaseUrl)('native MySQL migration deployment', () => {
  it('deploys a fresh database and applies the additive repair after later migrations without rewriting history', async () => {
    const url = new URL(databaseUrl!)
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Migration fixtures require a dedicated local test server')
    const database = `sv_plugin_test_${randomBytes(8).toString('hex')}`
    const connection = { host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), allowPublicKeyRetrieval: true }
    const admin = await mariadb.createConnection(connection)
    const deploy = async () => {
      url.pathname = `/${database}`
      try {
        await run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'prisma/providers/mysql/schema.prisma'], {
          cwd: process.cwd(), timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
          env: { ...process.env, NODE_ENV: 'production', SLOTHVAULT_PRISMA_PROVIDER: 'mysql', SLOTHVAULT_PRISMA_DATABASE_URL: url.toString() },
        })
      } catch (error) {
        const result = error as { stderr?: string; stdout?: string }
        throw new Error(`${result.stdout ?? ''}\n${result.stderr ?? ''}`.replaceAll(url.toString(), '[TEST_DATABASE_URL]').replaceAll(connection.password, '[TEST_PASSWORD]'))
      }
    }
    let client: Awaited<ReturnType<typeof mariadb.createConnection>> | undefined
    try {
      await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
      await deploy()
      client = await mariadb.createConnection({ ...connection, database })
      const history = await client.query('SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name')
      expect(history.some((row: { migration_name: string }) => row.migration_name === repair)).toBe(true)
      expect(history.at(-1).migration_name).toBe('20261021000000_project_menu_icons')
      // Emulate an already deployed installation with later migration receipts:
      // only this test DB loses the new repair's receipt, never production data.
      await client.query('CREATE INDEX fixture_existing_version_fk ON release_credential (project_version_id)')
      await client.query('DROP INDEX idx_release_credential_project_version_fk ON release_credential')
      await client.query('DELETE FROM _prisma_migrations WHERE migration_name = ?', [repair])
      await client.query('CREATE TABLE migration_data_probe (id INTEGER PRIMARY KEY, value VARCHAR(30))')
      await client.query("INSERT INTO migration_data_probe VALUES (1, 'preserved')")
      await deploy()
      const current = await client.query('SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name')
      expect([...current]).toEqual([...history])
      expect((await client.query('SELECT value FROM migration_data_probe WHERE id = 1'))[0].value).toBe('preserved')
      const indexes = await client.query("SHOW INDEX FROM release_credential WHERE Key_name = 'idx_release_credential_project_version_fk'")
      expect(indexes).toHaveLength(1)
      await deploy() // Repeated startup must remain idempotent.
    } finally {
      await client?.end()
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``)
      await admin.end()
    }
  }, 120_000)
})
