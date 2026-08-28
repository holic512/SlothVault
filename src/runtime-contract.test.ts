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
  const composeFileNames = [
    'docker-compose.yml',
    'docker-compose.mysql.yml',
    'docker-compose.postgresql.yml',
  ] as const

  function readComposeFiles() {
    return Object.fromEntries(
      composeFileNames.map((fileName) => [fileName, readFileSync(join(root, fileName), 'utf8')]),
    ) as Record<(typeof composeFileNames)[number], string>
  }

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
    const composeFiles = readComposeFiles()
    const entrypoint = readFileSync(join(root, 'docker-entrypoint.sh'), 'utf8')
    const deploymentEntrypoint = readFileSync(join(root, 'deploy', 'install.py'), 'utf8')
    const deploymentCompose = readFileSync(
      join(root, 'deploy', 'slothvault_deploy', 'compose.py'),
      'utf8',
    )
    const deploymentNginx = readFileSync(
      join(root, 'deploy', 'slothvault_deploy', 'nginx.py'),
      'utf8',
    )
    const deploymentCertbot = readFileSync(
      join(root, 'deploy', 'slothvault_deploy', 'certbot.py'),
      'utf8',
    )
    const deploymentCli = readFileSync(
      join(root, 'deploy', 'slothvault_deploy', 'cli.py'),
      'utf8',
    )
    const sanitizer = readFileSync(
      join(root, 'scripts', 'sanitize-standalone.mjs'),
      'utf8',
    )
    const workflow = readFileSync(
      join(root, '.github', 'workflows', 'docker-build.yml'),
      'utf8',
    )
    const deploymentSources = `${dockerfile}\n${Object.values(composeFiles).join('\n')}\n${entrypoint}`
    expect(deploymentSources).not.toContain('/app/public/uploads')
    expect(deploymentSources).not.toContain('.output/server')
    expect(dockerfile).toContain('.next/standalone')
    expect(dockerfile).not.toContain('COPY --from=builder /app/.next/static ./.next/static')
    expect(composeFiles['docker-compose.yml']).toContain('name: slothvault-sqlite')
    expect(composeFiles['docker-compose.yml']).toContain('/app/data')
    expect(composeFiles['docker-compose.mysql.yml']).toContain('name: slothvault-mysql')
    expect(composeFiles['docker-compose.mysql.yml']).toContain('condition: service_healthy')
    expect(composeFiles['docker-compose.postgresql.yml']).toContain('name: slothvault-postgresql')
    expect(composeFiles['docker-compose.postgresql.yml']).toContain('condition: service_healthy')
    for (const compose of Object.values(composeFiles)) {
      expect(compose).toContain('/app/data/uploads')
      expect(compose).not.toContain('profiles:')
      expect(compose).not.toContain('container_name:')
    }
    expect(entrypoint).toContain('exec node server.js')
    expect(entrypoint).toContain('SLOTHVAULT_AUTO_BOOTSTRAP')
    expect(existsSync(join(root, 'install.py'))).toBe(false)
    expect(deploymentEntrypoint).toContain('from slothvault_deploy.cli import main')
    expect(deploymentCompose).toContain('DEFAULT_ROOT = Path("/data/slothvault")')
    expect(deploymentCompose).toContain('compose_command')
    expect(deploymentCompose).toContain('127.0.0.1:{0}:3000')
    expect(deploymentNginx).toContain('proxy_set_header X-Forwarded-For')
    expect(deploymentNginx).toContain('return 301 https://$host$request_uri;')
    expect(deploymentNginx).toContain('class SystemNginxManager')
    expect(deploymentNginx).toContain('class DockerNginxManager')
    expect(deploymentNginx).toContain('"inspect", "--type", "container", container_name')
    expect(deploymentNginx).toContain('OFFICIAL_NGINX_IMAGES')
    expect(deploymentNginx).toContain('Docker Nginx 必须把 /etc/nginx/conf.d 或 /etc/nginx')
    expect(deploymentNginx).toContain('proxy_pass http://{1};')
    expect(deploymentNginx).toContain('upstream_host="slothvault"')
    expect(deploymentNginx).toContain('不支持宝塔或第三方面板托管 Nginx')
    expect(deploymentCli).toContain('--nginx-mode')
    expect(deploymentCli).toContain('--nginx-container')
    expect(deploymentCli).toContain('ensure_shared_slothvault_network')
    expect(deploymentCli).toContain('自动模式不会扫描或接管 Docker 容器')
    expect(deploymentCertbot).toContain('certonly')
    expect(deploymentCertbot).toContain('--webroot')
    expect(deploymentCertbot).toContain('slothvault-certbot-renew.timer')
    expect(deploymentCertbot).toContain('DockerNginxManager')
    expect(deploymentCertbot).toContain('exec {docker} exec {container} nginx -s reload')
    expect(`${deploymentEntrypoint}\n${deploymentCompose}\n${deploymentNginx}\n${deploymentCertbot}`).not.toContain(
      'import yaml',
    )
    expect(workflow).toContain('git archive --format=zip --prefix=deploy/')
    expect(workflow).toContain('gh release upload "$RELEASE_TAG" ./slothvault-deploy.zip --clobber')
    expect(sanitizer).toContain('removeSourceMaps(standaloneRoot)')
    expect(sanitizer).toContain('pruneSharpRuntimePackages(standaloneRoot)')
    expect(workflow).toContain('Inspect published image sizes')
    expect(workflow).toContain('Compressed Image Size')
  })

  it('keeps the runtime free of the removed Redis service', () => {
    const composeFiles = readComposeFiles()
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
    for (const compose of Object.values(composeFiles)) {
      expect(compose).not.toMatch(/^\s{2}redis:/m)
      expect(compose).not.toContain('REDIS_')
    }
  })

  it('persists signed release evidence before broadcast and removes the cNFT runtime', () => {
    const evidenceService = readFileSync(
      join(root, 'src', 'server', 'services', 'release-evidence.ts'),
      'utf8',
    )
    const chainService = readFileSync(
      join(root, 'src', 'server', 'services', 'release-evidence-chain.ts'),
      'utf8',
    )
    const schema = readFileSync(
      join(root, 'prisma', 'providers', 'postgresql', 'schema.prisma'),
      'utf8',
    )

    expect(chainService).toContain('finalizedEvidenceTransaction')
    expect(evidenceService.indexOf('transactionSignature: signature'))
      .toBeLessThan(evidenceService.indexOf('connection.sendRawTransaction(raw'))
    expect(schema).toMatch(/model ReleaseCredential \{/)
    expect(schema).toMatch(/@@unique\(\[subjectType, subjectId, network\]/)
    expect(schema).toMatch(/noteContentId\s+Int\?/)
    expect(schema).toMatch(/model ReleaseCredentialAttempt \{/)
    expect(schema).not.toContain('model MerkleTree')
    expect(schema).not.toContain('model CompressedNft')
    expect(existsSync(join(root, 'src', 'server', 'services', 'solana-chain.ts'))).toBe(false)
    expect(existsSync(join(root, 'src', 'server', 'services', 'filebase.ts'))).toBe(false)
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
