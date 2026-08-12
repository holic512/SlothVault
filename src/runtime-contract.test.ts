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

  it('keeps the active runtime on the native Next.js stack', () => {
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      scripts?: Record<string, string>
    }
    const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
      packages?: Record<string, unknown>
    }
    const installedPackages = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    }
    const forbiddenDirectPackages = [
      'nuxt',
      '@nuxt/kit',
      '@nuxt/schema',
      '@nuxtjs/i18n',
      'nitropack',
      'h3',
      'vue',
      'vue-router',
      'pinia',
      'element-plus',
    ]
    const forbiddenLockedPackages = Object.keys(packageLock.packages ?? {}).filter(
      (path) =>
        /^node_modules\/(?:nuxt|@nuxt\/|@nuxtjs\/|nitropack|h3|vue|@vue\/|vue-router|pinia|element-plus)(?:\/|$)/.test(
          path,
        ),
    )
    const forbiddenImportPatterns = [
      /(?:from|import\()\s*['"](?:nuxt|nuxt\/|@nuxt\/|@nuxtjs\/)/,
      /(?:from|import\()\s*['"](?:vue|vue-router|pinia|element-plus|h3)['"]/,
      /(?:from|import\()\s*['"](?:#app|#imports)['"]/,
      /(?:from|import\()\s*['"]~~\//,
      /require\(\s*['"](?:nuxt|nuxt\/|@nuxt\/|@nuxtjs\/|vue|vue-router|pinia|element-plus|h3)['"]\s*\)/,
    ]
    const activeSources = walk(join(root, 'src')).filter(
      (file) => /\.(ts|tsx)$/.test(file) && !/\.(test|spec)\.(ts|tsx)$/.test(file),
    )
    const legacyImports = activeSources
      .filter((file) => {
        const source = readFileSync(file, 'utf8')
        return forbiddenImportPatterns.some((pattern) => pattern.test(source))
      })
      .map((file) => normalizedPath(relative(root, file)))

    expect(packageJson.dependencies?.next).toBeDefined()
    expect(packageJson.scripts?.dev).toBe('next dev')
    expect(packageJson.scripts?.build).toContain('next build')
    expect(forbiddenDirectPackages.filter((name) => installedPackages[name])).toEqual([])
    expect(forbiddenLockedPackages).toEqual([])
    expect(legacyImports).toEqual([])
    for (const obsoleteDirectory of [
      'legacy-nuxt',
      'server',
      'plugins',
      'i18n',
      'data/uploads-legacy-nuxt',
    ]) {
      expect(existsSync(join(root, obsoleteDirectory))).toBe(false)
    }
    expect(existsSync(join(root, 'nuxt.config.ts'))).toBe(false)
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

  it('keeps the runtime free of the removed Redis service', () => {
    const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8')
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      scripts: Record<string, string>
    }
    const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, unknown>
    }

    expect(packageJson.dependencies).not.toHaveProperty('redis')
    expect(packageJson.scripts.dev).toBe('next dev')
    expect(packageJson.scripts).not.toHaveProperty('dev:services')
    expect(packageLock.packages).not.toHaveProperty('node_modules/redis')
    expect(compose).not.toMatch(/^\s{2}redis:/m)
    expect(compose).not.toContain('REDIS_')
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
