import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

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

describe('Next runtime contract', () => {
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
    const cnftService = [
      'attempts.ts',
      'submit.ts',
    ].map((file) =>
      readFileSync(
        join(root, 'src', 'server', 'services', 'admin-solana-cnfts', file),
        'utf8',
      ),
    ).join('\n')
    const chainService = readFileSync(
      join(root, 'src', 'server', 'services', 'solana-chain.ts'),
      'utf8',
    )
    const schema = readFileSync(
      join(root, 'prisma', 'providers', 'postgresql', 'schema.prisma'),
      'utf8',
    )

    expect(chainService).toContain('deserializeChangeLogEventV1')
    expect(chainService).toContain('inspectMintTransaction')
    expect(cnftService).toContain('finalizeSuccessfulAttempt')
    expect(cnftService).not.toContain('getAssetId(\n    parseSolanaPublicKey(session.treeAddress')
    expect(cnftService.indexOf('persistSubmittedSignature(cnftId, expectedSignature)'))
      .toBeLessThan(cnftService.indexOf('sendAndConfirmPreparedTransaction({'))
    expect(schema).toMatch(/prepareExpiresAt\s+DateTime\?/)
    expect(schema).toMatch(/lastValidBlockHeight\s+BigInt\?/)
    expect(schema).toMatch(/mintTxSignature\s+String\?\s+@unique/)
    expect(schema).toMatch(/remainingCapacity\s+BigInt/)
    expect(schema).toMatch(/capacityReserved\s+Boolean/)
  })

  it('coordinates streamed backups with state-changing Route Handlers', () => {
    const handler = readFileSync(join(root, 'src', 'server', 'http', 'handler.ts'), 'utf8')
    const filesExport = readFileSync(
      join(root, 'src', 'app', 'api', 'admin', 'mm', 'backup', 'files-export', 'route.ts'),
      'utf8',
    )
    const databaseBackup = readFileSync(
      join(
        root,
        'src',
        'server',
        'services',
        'admin-backup',
        'database-export.ts',
      ),
      'utf8',
    )

    expect(handler).toContain("method === 'GET' || method === 'HEAD'")
    expect(handler).toContain('acquireMaintenanceLock(mode)')
    expect(filesExport).toContain('holdLockUntilBodyClosed: true')
    expect(databaseBackup).toContain('databaseSnapshotIsolationLevel()')
    expect(databaseBackup).toContain('relationClosedMenus')
  })
})
