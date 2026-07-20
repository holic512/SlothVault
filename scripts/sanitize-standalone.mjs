/**
 * @file sanitize-standalone.mjs
 * @project SlothVault
 * @module Production Build
 * @description Completes the compiled Turbopack runtime and removes build-host secrets or mutable data from standalone output.
 * @logic Copy generated server chunks and the fixed Prisma migration CLI omitted by NFT, delete environment files and runtime-data directories, then fail if any forbidden artifact remains.
 * @dependencies node:fs/promises, node:path
 * @index_tags nextjs,standalone,security,build,sanitization
 * @author holic512
 */
import { access, cp, mkdir, readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const standaloneRoot = resolve(process.cwd(), '.next', 'standalone')
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

await cp(
  resolve(process.cwd(), '.next', 'server', 'chunks'),
  resolve(standaloneRoot, '.next', 'server', 'chunks'),
  { recursive: true, force: true },
)
await cp(
  resolve(process.cwd(), 'node_modules', 'prisma'),
  resolve(standaloneRoot, 'node_modules', 'prisma'),
  { recursive: true, force: true },
)
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
