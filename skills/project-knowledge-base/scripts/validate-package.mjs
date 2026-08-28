#!/usr/bin/env node
/**
 * @file validate-package.mjs
 * @project SlothVault
 * @module Knowledge Package Validator
 * @description Strictly checks a portable ZIP against SlothVault's schema, source-evidence, size, path, digest, and Markdown-mirror requirements.
 * @logic Read one local ZIP only after source-root input is supplied, then delegate all structural and archive checks to the shared package contract.
 * @dependencies package contract, Node.js filesystem/path APIs
 * @index_tags skill, knowledge-package, zip, validator, sha256, markdown
 * @author holic512
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { validateKnowledgePackageArchive } from './package-contract.mjs'

function usage() {
  throw new Error('Usage: node validate-package.mjs <package.zip> --source-root <project-directory>')
}

const [archivePath, ...argumentsList] = process.argv.slice(2)
if (!archivePath || argumentsList.length !== 2 || argumentsList[0] !== '--source-root' || !argumentsList[1]) {
  usage()
}

const bytes = await readFile(resolve(archivePath))
await validateKnowledgePackageArchive(bytes, { sourceRoot: argumentsList[1] })
process.stdout.write(`Valid knowledge package: ${resolve(archivePath)}\n`)
