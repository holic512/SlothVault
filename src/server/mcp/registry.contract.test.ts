import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const mcpDirectory = path.dirname(fileURLToPath(import.meta.url))
const toolDirectory = path.join(mcpDirectory, 'tools')

/** Reads all Tool declaration module source for static contract checks. */
function readToolSource() {
  return fs.readdirSync(toolDirectory)
    .filter((fileName) => fileName.endsWith('.ts'))
    .map((fileName) => fs.readFileSync(path.join(toolDirectory, fileName), 'utf8'))
    .join('\n')
}

/** Extracts Tool names in declaration order. */
function readToolNames() {
  return [...readToolSource().matchAll(/defineTool\(\s*'([^']+)'/g)].map((match) => match[1])
}

describe('MCP declaration registry contract', () => {
  it('keeps the complete 55-tool registry unique and adapter-only', () => {
    const names = readToolNames()
    expect(names).toHaveLength(55)
    expect(new Set(names).size).toBe(names.length)
    const sdkToolRegistration = ['server', 'registerTool'].join('.')
    expect(readToolSource()).not.toContain(`${sdkToolRegistration}(`)
    expect(fs.readFileSync(path.join(mcpDirectory, 'registry.ts'), 'utf8')).toContain(`${sdkToolRegistration}(`)
  })

  it('keeps the two protected Resource templates isolated and bounded', () => {
    const source = fs.readFileSync(path.join(mcpDirectory, 'resources.ts'), 'utf8')
    const catalog = JSON.parse(fs.readFileSync(path.join(mcpDirectory, 'resource-catalog.json'), 'utf8'))
    expect(catalog.map((item: { name: string }) => item.name)).toEqual(['managed-file', 'contract-attachment'])
    expect(new Set(catalog.map((item: { uriTemplate: string }) => item.uriTemplate)).size).toBe(2)
    expect(catalog.every((item: { maxNameLength: number }) => item.maxNameLength === 255)).toBe(true)
    expect(catalog.every((item: { maxBytes: number }) => item.maxBytes > 0)).toBe(true)
    expect(source).toContain("file.businessType === 'ContractAttachment'")
  })

  it('declares metadata, schemas, and handlers for every Tool', () => {
    const source = readToolSource()
    expect([...source.matchAll(/defineTool\(/g)]).toHaveLength(55)
    expect([...source.matchAll(/inputSchema:/g)]).toHaveLength(55)
    expect([...source.matchAll(/outputSchema:/g)]).toHaveLength(55)
    expect(source).toContain('READ_ONLY_ANNOTATIONS')
    expect(source).toContain('CREATE_ANNOTATIONS')
    expect(source).toContain('UPDATE_ANNOTATIONS')
  })

  it('keeps the Request Context and execution stages explicit', () => {
    const registry = fs.readFileSync(path.join(mcpDirectory, 'registry.ts'), 'utf8')
    for (const field of ['principal', 'apiKeyId', 'requestId', 'startedAt', 'abortSignal']) {
      expect(registry).toContain(`${field}:`)
    }
    expect(registry).toContain('assertToolPolicy(definition, context)')
    expect(registry).toContain('normalizeToolResult(result, definition)')
    expect(registry).toContain('mcpErrorResult(error, definition.name)')
    expect(registry).toContain('await auditSink({')
  })

  it('rejects stable wildcard records and high-risk Tool names', () => {
    const source = readToolSource()
    const wildcardRecord = ['z.record', '(z.string(), z.unknown())'].join('')
    expect(source).not.toContain(wildcardRecord)
    for (const forbidden of ['.delete', '.restore', '.publish', '.revoke', '.batch']) {
      expect(readToolNames().some((name) => name.endsWith(forbidden))).toBe(false)
    }
  })

  it('declares nested credential and request-identifying field redaction', () => {
    const common = fs.readFileSync(path.join(toolDirectory, 'common.ts'), 'utf8')
    for (const field of ['passwordHash', 'sessionId', 'secretHash', 'privateKey', 'ip', 'userAgent']) {
      expect(common).toContain(`'${field}'`)
    }
    expect(common).toContain('value instanceof Date')
    expect(common).toContain('item.toString()')
  })

  it('keeps Prompt Tool references registered', () => {
    const promptSource = fs.readFileSync(path.join(mcpDirectory, 'prompts.ts'), 'utf8')
    const names = new Set(readToolNames())
    const references = [...promptSource.matchAll(/\b(?:content|admin)\.[a-z0-9_.]+/g)]
      .map((match) => match[0])
      .filter((name) => name.includes('.') && !name.endsWith('.'))
    for (const name of references) {
      expect(names.has(name), `Prompt references unregistered Tool ${name}`).toBe(true)
    }
  })

  it('keeps the generated registry document current', () => {
    const document = fs.readFileSync(path.join(mcpDirectory, '..', '..', '..', 'docs', 'MCP_REGISTRY.md'), 'utf8')
    expect(document).toContain('Tool count: **55**')
    expect(document).toContain('Resource count: **2**')
    for (const name of readToolNames()) expect(document).toContain(`\`${name}\``)
  })

  it('keeps the existing error mapping baseline wired into the adapter', () => {
    const common = fs.readFileSync(path.join(toolDirectory, 'common.ts'), 'utf8')
    const registry = fs.readFileSync(path.join(mcpDirectory, 'registry.ts'), 'utf8')
    expect(common).toContain("message: 'Internal server error'")
    expect(common).toContain('safeHttpErrorData(error.data)')
    expect(registry).toContain('mcpErrorResult(error, definition.name)')
    expect(registry).toContain("return new Error('Internal server error')")
  })
})
