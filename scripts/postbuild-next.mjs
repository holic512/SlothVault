#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'

const sourceFile = join(process.cwd(), 'server/utils/solana.cjs')
const targets = [
  join(process.cwd(), '.next/standalone/server/utils/solana.cjs'),
  join(process.cwd(), '.next/server/utils/solana.cjs')
]

for (const target of targets) {
  if (!existsSync(dirname(target))) {
    mkdirSync(dirname(target), { recursive: true })
  }
  copyFileSync(sourceFile, target)
  console.log(`[postbuild-next] copied ${sourceFile} -> ${target}`)
}
