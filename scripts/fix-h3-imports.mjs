#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs'
import { globSync } from 'glob'

const tokens = [
  'defineEventHandler',
  'createError',
  'setResponseHeaders',
  'readMultipartFormData',
  'readBody',
  'getRouterParam',
  'getQuery',
  'setResponseStatus',
  'H3Event',
  'setCookie',
  'getCookie',
  'deleteCookie'
]

for (const file of globSync('server/**/*.{ts,tsx}', {
  ignore: ['**/*.d.ts']
})) {
  const source = readFileSync(file, 'utf8')
  const needed = tokens.filter((token) => new RegExp(`\\b${token}\\b`).test(source))
  if (needed.length === 0) {
    continue
  }

  const importMatch = source.match(/import\s*\{([^}]*)\}\s*from\s*['"]h3['"]/)
  if (importMatch) {
    const existing = importMatch[1]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const merged = Array.from(new Set([...existing, ...needed])).sort()
    const nextSource = source.replace(importMatch[0], `import { ${merged.join(', ')} } from 'h3'`)
    if (nextSource !== source) {
      writeFileSync(file, nextSource)
    }
    continue
  }

  const firstImport = source.match(/^import .*$/m)
  const importLine = `import { ${needed.sort().join(', ')} } from 'h3'\n`
  if (firstImport) {
    const nextSource = source.replace(firstImport[0], `${firstImport[0]}\n${importLine.trimEnd()}`)
    writeFileSync(file, nextSource)
  } else {
    writeFileSync(file, `${importLine}\n${source}`)
  }
}
