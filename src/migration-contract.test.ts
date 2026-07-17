import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = process.cwd()

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

function normalizedPath(path: string) {
  return path.split(sep).join('/')
}

function legacyApiContracts() {
  const apiRoot = join(root, 'server', 'api')
  return walk(apiRoot)
    .filter((file) => /\.(get|post|put|patch|delete)\.ts$/.test(file))
    .map((file) => {
      const relativePath = normalizedPath(relative(apiRoot, file))
      const match = /\.(get|post|put|patch|delete)\.ts$/.exec(relativePath)
      if (!match) throw new Error(`Unable to parse legacy API method: ${relativePath}`)
      const route = relativePath
        .replace(/\/index\.(get|post|put|patch|delete)\.ts$/, '')
        .replace(/\.(get|post|put|patch|delete)\.ts$/, '')
      return `${match[1].toUpperCase()} /api/${route}`
    })
}

function nextApiContracts() {
  const apiRoot = join(root, 'src', 'app', 'api')
  return walk(apiRoot)
    .filter((file) => file.endsWith(`${sep}route.ts`))
    .flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const route = normalizedPath(relative(apiRoot, dirname(file)))
      return [...source.matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE|HEAD)\b/g)]
        .map((match) => `${match[1]} /api/${route}`)
    })
}

describe('Nuxt to Next migration contract', () => {
  it('preserves every legacy API URL and HTTP method', () => {
    const legacy = legacyApiContracts()
    const next = new Set(nextApiContracts())
    expect(legacy).toHaveLength(80)
    expect(legacy.filter((contract) => !next.has(contract))).toEqual([])
  })

  it('guards every non-authentication admin Route Handler', () => {
    const adminRoot = join(root, 'src', 'app', 'api', 'admin')
    const unguarded = walk(adminRoot)
      .filter(
        (file) =>
          file.endsWith(`${sep}route.ts`) &&
          !normalizedPath(relative(adminRoot, file)).startsWith('auth/'),
      )
      .filter((file) => !readFileSync(file, 'utf8').includes('requireAdminSession(request)'))
      .map((file) => normalizedPath(relative(root, file)))
    expect(unguarded).toEqual([])
  })

  it('keeps the active runtime free of Nuxt/Vue imports and public uploads', () => {
    const activeSources = walk(join(root, 'src')).filter(
      (file) => /\.(ts|tsx)$/.test(file) && !/\.(test|spec)\.(ts|tsx)$/.test(file),
    )
    const legacyImports = activeSources
      .filter((file) => {
        const source = readFileSync(file, 'utf8')
        return (
          /from ['"]vue['"]/.test(source) ||
          /from ['"]#app['"]/.test(source) ||
          /from ['"]element-plus['"]/.test(source) ||
          source.includes("from '~~/") ||
          source.includes('from "~~/')
        )
      })
      .map((file) => normalizedPath(relative(root, file)))
    expect(legacyImports).toEqual([])
    expect(existsSync(join(root, 'public', 'uploads'))).toBe(false)
  })

  it('uses the Next standalone and private upload Docker contract', () => {
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
    const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8')
    const entrypoint = readFileSync(join(root, 'docker-entrypoint.sh'), 'utf8')
    const deploymentSources = `${dockerfile}\n${compose}\n${entrypoint}`
    expect(deploymentSources).not.toContain('/app/public/uploads')
    expect(deploymentSources).not.toContain('.output/server')
    expect(dockerfile).toContain('.next/standalone')
    expect(compose).toContain('/app/data/uploads')
    expect(entrypoint).toContain('exec node server.js')
  })

  it('persists and reconciles cNFT attempts from confirmed chain events', () => {
    const cnftService = readFileSync(
      join(root, 'src', 'server', 'services', 'admin-solana-cnfts.ts'),
      'utf8',
    )
    const chainService = readFileSync(
      join(root, 'src', 'server', 'services', 'solana-chain.ts'),
      'utf8',
    )
    const schema = readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf8')

    expect(chainService).toContain('deserializeChangeLogEventV1')
    expect(chainService).toContain('inspectMintTransaction')
    expect(cnftService).toContain('finalizeSuccessfulAttempt')
    expect(cnftService).not.toContain('getAssetId(\n    parseSolanaPublicKey(session.treeAddress')
    expect(cnftService.indexOf('persistSubmittedSignature(cnftId, expectedSignature)'))
      .toBeLessThan(cnftService.indexOf('sendAndConfirmPreparedTransaction({'))
    expect(schema).toMatch(/prepareExpiresAt\s+DateTime\?/)
    expect(schema).toMatch(/lastValidBlockHeight\s+BigInt\?/)
    expect(schema).toMatch(/mintTxSignature\s+String\?\s+@unique/)
  })

  it('coordinates streamed backups with state-changing Route Handlers', () => {
    const handler = readFileSync(join(root, 'src', 'server', 'http', 'handler.ts'), 'utf8')
    const filesExport = readFileSync(
      join(root, 'src', 'app', 'api', 'admin', 'mm', 'backup', 'files-export', 'route.ts'),
      'utf8',
    )
    const databaseBackup = readFileSync(
      join(root, 'src', 'server', 'services', 'admin-backup.ts'),
      'utf8',
    )

    expect(handler).toContain("method === 'GET' || method === 'HEAD'")
    expect(handler).toContain('acquireMaintenanceLock(mode)')
    expect(filesExport).toContain('holdLockUntilBodyClosed: true')
    expect(databaseBackup).toContain('Prisma.TransactionIsolationLevel.RepeatableRead')
    expect(databaseBackup).toContain('relationClosedMenus')
  })
})
