#!/usr/bin/env node

import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join, relative } from 'path'
import { globSync } from 'glob'

const root = process.cwd()
const outputRoot = join(root, 'src/app')
rmSync(join(outputRoot, 'api'), { recursive: true, force: true })
rmSync(join(outputRoot, 'uploads'), { recursive: true, force: true })

const routeFiles = [
  ...globSync('server/api/**/*.ts'),
  ...globSync('server/routes/**/*.ts')
]

const grouped = new Map()

for (const file of routeFiles) {
  const relativePath = relative(join(root, 'server'), join(root, file))
  const appPath = mapToAppPath(relativePath)
  const routeTarget = join(outputRoot, appPath)
  const importPath = relative(dirname(routeTarget), join(root, file))
    .replace(/\\/g, '/')
    .replace(/\.ts$/, '')
  const method = detectMethod(file)
  const existing = grouped.get(routeTarget) || []
  existing.push({ method, importPath: normalizeImport(importPath) })
  grouped.set(routeTarget, existing)
}

for (const [target, handlers] of grouped.entries()) {
  mkdirSync(dirname(target), { recursive: true })
  const imports = [
    "import { handleLegacyApiRequest } from '@/server/compat/adapter'",
    "import type { NextRequest } from 'next/server'",
    ...handlers.map((handler, index) => `import handler${index} from '${handler.importPath}'`)
  ]

  const methodExports = handlers.map(
    (handler, index) =>
      `export async function ${handler.method}(request: NextRequest, context: { params: Promise<Record<string, string | string[]>> }) {\n  return handleLegacyApiRequest(handler${index}, request, await context.params)\n}`
  )

  writeFileSync(
    target,
    [...imports, '', "export const runtime = 'nodejs'", '', ...methodExports, ''].join('\n')
  )
}

function detectMethod(file) {
  if (file.endsWith('.get.ts')) return 'GET'
  if (file.endsWith('.post.ts')) return 'POST'
  if (file.endsWith('.put.ts')) return 'PUT'
  if (file.endsWith('.delete.ts')) return 'DELETE'
  return 'GET'
}

function mapToAppPath(relativePath) {
  if (relativePath.startsWith('api/')) {
    let normalized = relativePath.replace(/^api\//, 'api/')
    normalized = normalized.replace(/\/index\.(get|post|put|delete)\.ts$/, '/route.ts')
    normalized = normalized.replace(/\.((get|post|put|delete))\.ts$/, '/route.ts')
    return normalized
  }

  if (relativePath.startsWith('routes/')) {
    return relativePath.replace(/^routes\//, '').replace(/\.get\.ts$/, '/route.ts')
  }

  throw new Error(`Unsupported route source: ${relativePath}`)
}

function normalizeImport(value) {
  return value.startsWith('.') ? value : `./${value}`
}
