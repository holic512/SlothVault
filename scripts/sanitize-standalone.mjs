/**
 * @file sanitize-standalone.mjs
 * @project SlothVault
 * @module Production Build
 * @description Completes the compiled Turbopack runtime, adds the minimal Prisma migration CLI dependency closure, and removes build-host secrets or mutable data.
 * @logic Copy generated server chunks, external aliases, production Next runtimes, and the Prisma command graph; delete unsafe build inputs and verify the result.
 * @dependencies node:fs/promises, node:path
 * @index_tags nextjs,standalone,security,build,sanitization
 * @author holic512
 */
import { access, cp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

const projectRoot = resolve(process.cwd())
const standaloneRoot = resolve(projectRoot, '.next', 'standalone')
const sourceNodeModules = resolve(projectRoot, 'node_modules')
// Prisma 7.3 eagerly resolves these command modules even for `migrate deploy`.
// Keep this list pinned to the installed CLI and re-run the isolation checks on upgrade.
const runtimeDependencyAllowlist = new Map([
  [
    'prisma',
    new Set([
      '@prisma/config',
      '@prisma/dev',
      '@prisma/engines',
      '@prisma/studio-core',
    ]),
  ],
  [
    '@prisma/dev',
    new Set([
      '@mrleebo/prisma-ast',
      '@prisma/get-platform',
      '@prisma/query-plan-executor',
      'get-port-please',
      'hono',
      'http-status-codes',
      'pathe',
      'proper-lockfile',
      'remeda',
      'std-env',
      'valibot',
      'zeptomatch',
    ]),
  ],
])
const studioCoreRuntimePaths = ['dist/data']
const forbiddenDirectories = [
  'data',
  'docker-data',
  'docs',
  'legacy-nuxt',
  'server',
  'src',
]

try {
  await access(standaloneRoot)
} catch {
  process.exit(0)
}

async function installedPackageJson(packageDirectory, dependencyName) {
  let cursor = packageDirectory

  while (true) {
    const candidate = resolve(cursor, 'node_modules', dependencyName, 'package.json')
    try {
      await access(candidate)
      return candidate
    } catch {
      if (cursor === projectRoot) return undefined
      const parent = dirname(cursor)
      if (parent === cursor) return undefined
      cursor = parent
    }
  }
}

async function copyRuntimePackageClosure(rootPackageName) {
  const queue = [resolve(sourceNodeModules, rootPackageName, 'package.json')]
  const visited = new Set()

  while (queue.length > 0) {
    const packageJsonPath = queue.shift()
    if (!packageJsonPath || visited.has(packageJsonPath)) continue
    visited.add(packageJsonPath)

    const packageDirectory = dirname(packageJsonPath)
    const destinationRelativePath = relative(projectRoot, packageDirectory)
    if (
      destinationRelativePath === 'node_modules' ||
      !destinationRelativePath.startsWith(`node_modules/`)
    ) {
      throw new Error(`Runtime package escaped node_modules: ${packageDirectory}`)
    }

    const manifest = JSON.parse(await readFile(packageJsonPath, 'utf8'))
    const destinationPackageDirectory = resolve(
      standaloneRoot,
      destinationRelativePath,
    )
    if (manifest.name === '@prisma/studio-core') {
      await mkdir(destinationPackageDirectory, { recursive: true })
      await cp(
        packageJsonPath,
        resolve(destinationPackageDirectory, 'package.json'),
        { force: true },
      )
      for (const runtimePath of studioCoreRuntimePaths) {
        await cp(
          resolve(packageDirectory, runtimePath),
          resolve(destinationPackageDirectory, runtimePath),
          { recursive: true, force: true },
        )
      }
    } else {
      await cp(packageDirectory, destinationPackageDirectory, {
        recursive: true,
        force: true,
      })
    }

    const dependencyAllowlist = runtimeDependencyAllowlist.get(manifest.name)
    const requiredDependencies = Object.keys(manifest.dependencies ?? {}).filter(
      (dependencyName) =>
        !dependencyAllowlist || dependencyAllowlist.has(dependencyName),
    )
    const optionalDependencies = new Set(
      Object.keys(manifest.optionalDependencies ?? {}),
    )
    const dependencyNames = new Set([
      ...requiredDependencies,
      ...optionalDependencies,
    ])

    for (const dependencyName of dependencyNames) {
      const dependencyPackageJson = await installedPackageJson(
        packageDirectory,
        dependencyName,
      )
      if (dependencyPackageJson) {
        queue.push(dependencyPackageJson)
      } else if (!optionalDependencies.has(dependencyName)) {
        throw new Error(
          `Missing runtime dependency ${dependencyName} required by ${manifest.name}`,
        )
      }
    }
  }
}

async function copyNextProductionRuntimes() {
  const sourceDirectory = resolve(
    sourceNodeModules,
    'next',
    'dist',
    'compiled',
    'next-server',
  )
  const destinationDirectory = resolve(
    standaloneRoot,
    'node_modules',
    'next',
    'dist',
    'compiled',
    'next-server',
  )
  await mkdir(destinationDirectory, { recursive: true })

  const entries = await readdir(sourceDirectory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.runtime.prod.js')) {
      await cp(
        resolve(sourceDirectory, entry.name),
        resolve(destinationDirectory, entry.name),
        { force: true },
      )
    }
  }
}

await cp(
  resolve(process.cwd(), '.next', 'server', 'chunks'),
  resolve(standaloneRoot, '.next', 'server', 'chunks'),
  { recursive: true, force: true },
)
await cp(
  resolve(projectRoot, '.next', 'node_modules'),
  resolve(standaloneRoot, '.next', 'node_modules'),
  { recursive: true, force: true, verbatimSymlinks: true },
)
await copyNextProductionRuntimes()
await copyRuntimePackageClosure('prisma')
await cp(
  resolve(process.cwd(), '.next', 'static'),
  resolve(standaloneRoot, '.next', 'static'),
  { recursive: true, force: true },
)
await mkdir(resolve(standaloneRoot, 'public'), { recursive: true })
for (const asset of ['favicon.ico', 'logo.png', 'robots.txt']) {
  await cp(
    resolve(process.cwd(), 'public', asset),
    resolve(standaloneRoot, 'public', asset),
    { force: true },
  )
}

const entries = await readdir(standaloneRoot, { withFileTypes: true })
const forbiddenNames = new Set(forbiddenDirectories)
for (const entry of entries) {
  if (entry.name.startsWith('.env') || forbiddenNames.has(entry.name)) {
    await rm(resolve(standaloneRoot, entry.name), { recursive: true, force: true })
  }
}

const remaining = await readdir(standaloneRoot)
const unsafe = remaining.filter(
  (name) => name.startsWith('.env') || forbiddenNames.has(name),
)
if (unsafe.length > 0) {
  throw new Error(`Unsafe standalone artifacts remain: ${unsafe.join(', ')}`)
}
