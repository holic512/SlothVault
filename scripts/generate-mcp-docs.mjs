import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const toolDirectory = path.join(projectRoot, 'src', 'server', 'mcp', 'tools')
const outputPath = path.join(projectRoot, 'docs', 'MCP_REGISTRY.md')

/** Reads unique Tool names from declaration modules. */
function readToolNames() {
  const names = []
  for (const fileName of fs.readdirSync(toolDirectory).filter((name) => name.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(toolDirectory, fileName), 'utf8')
    for (const match of source.matchAll(/defineTool\(\s*'([^']+)'/g)) names.push(match[1])
  }
  return [...new Set(names)]
}

/** Reads the structured Resource catalog shared with runtime registration. */
function readResources() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'src', 'server', 'mcp', 'resource-catalog.json'),
    'utf8',
  )
  return JSON.parse(source)
}

/** Classifies generated documentation risk from the terminal operation. */
function riskFor(name) {
  return /\.(get|list|check_draft|integrity|manifest)$/.test(name) ? 'read' : 'write'
}

/** Returns the declared Resource permission inferred by the runtime registry. */
function resourcePermissionFor(name) {
  if (name === 'content.file.get') return 'managed-file:read'
  if (name === 'admin.contract.attachment.get') return 'contract-attachment:read'
  return '-'
}

/** Renders the deterministic registry inventory. */
function render() {
  const tools = readToolNames()
  const resources = readResources()
  const lines = [
    '# MCP Registry (generated)',
    '',
    '<!-- GENERATED FILE: run `npm run mcp:docs` after changing MCP declarations. -->',
    '',
    `Tool count: **${tools.length}**`,
    '',
    '| Tool | Domain | Risk | Idempotency | Resource permission |',
    '| --- | --- | --- | --- | --- |',
    ...tools.map((name) => {
      const parts = name.split('.')
      const domain = parts.slice(0, -1).join('.')
      const risk = riskFor(name)
      const idempotency = risk === 'read' ? 'idempotent' : 'non-idempotent'
      return `| \`${name}\` | \`${domain}\` | ${risk} | ${idempotency} | ${resourcePermissionFor(name)} |`
    }),
    '',
    `Resource count: **${resources.length}**`,
    '',
    '| Resource | URI | MIME | Filename limit | Maximum bytes |',
    '| --- | --- | --- | ---: | ---: |',
    ...resources.map((resource) =>
      `| \`${resource.name}\` | \`${resource.uriTemplate}\` | \`${resource.mimeType}\` | ${resource.maxNameLength} | ${resource.maxBytes} |`),
    '',
    'This document is generated from the declaration registry. CI must run `npm run mcp:docs:check` and fail when the checked-in output is stale.',
  ]
  return `${lines.join('\n')}\n`
}

const rendered = render()
if (process.argv.includes('--check')) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : ''
  if (current !== rendered) {
    console.error('MCP registry documentation is stale. Run: npm run mcp:docs')
    process.exitCode = 1
  }
} else {
  fs.writeFileSync(outputPath, rendered, 'utf8')
}
