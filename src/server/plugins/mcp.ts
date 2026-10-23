/**
 * @file mcp.ts
 * @project SlothVault
 * @module Plugin MCP Contributions
 * @description Adapts enabled plugin read/draft contributions to the host MCP registry.
 * @logic Bound schema conversion, bind the authenticated host actor, and recheck declaration, access and activation before invoking a worker through the audited adapter.
 * @dependencies plugin manager/state/access, MCP registry, zod
 * @index_tags plugins,mcp,authorization,schema,drafts
 * @author holic512
 */
import 'server-only'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { PluginManifest } from '@slothvault/plugin-sdk/protocol'
import { z } from 'zod'

import { HttpError } from '@/server/http/errors'
import { toJsonSafe } from '@/server/http/response'
import { registerMcpToolDefinitions, type McpToolDefinition } from '@/server/mcp/registry'
import { redactMcpSensitiveFields } from '@/server/mcp/tools/common'
import type { McpPrincipal } from '@/server/services/mcp-api-keys'

import { boundPluginAccess, canAccessPlugin, requirePluginAccess } from './access'
import { initializePlugins, invokeRegisteredPlugin } from './manager'
import { pluginRegistry } from './state'

type Contribution = PluginManifest['mcp'][number]
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor'])
const metadata = { title: z.string().max(200).optional(), description: z.string().max(2000).optional() }
const scalar = z.union([z.string().max(65536), z.number().finite(), z.boolean(), z.null()])
const common = { ...metadata, enum: z.array(scalar).min(1).max(100).optional(), const: scalar.optional() }
const length = z.number().int().min(0)
const objectSchema = z.object({ ...metadata, type: z.literal('object'), properties: z.record(z.string().max(100), z.unknown()).default({}), required: z.array(z.string().max(100)).max(100).default([]), additionalProperties: z.boolean().default(true) }).strict()
const arraySchema = z.object({ ...metadata, type: z.literal('array'), items: z.unknown(), minItems: length.max(1000).optional(), maxItems: length.max(1000).default(1000) }).strict()
const stringSchema = z.object({ ...common, type: z.literal('string'), minLength: length.max(65536).optional(), maxLength: length.max(65536).default(65536) }).strict()
const numberSchema = z.object({ ...common, type: z.enum(['number', 'integer']), minimum: z.number().finite().optional(), maximum: z.number().finite().optional() }).strict()
const primitiveSchema = z.object({ ...common, type: z.enum(['boolean', 'null']) }).strict()

/** Deliberately supports a finite JSON Schema subset; refs, regexes and combinators fail closed. */
export function pluginMcpInputSchema(input: Record<string, unknown>) {
  // Bound the entire JSON graph before conversion/stringification, including metadata and enums.
  let elements = 0, characters = 0
  const ancestry = new WeakSet<object>()
  function bound(value: unknown, depth: number) {
    if (++elements > 4096 || depth > 24) throw new Error('Plugin MCP schema is too large')
    if (typeof value === 'string') characters += value.length
    else if (value && typeof value === 'object') {
      if (ancestry.has(value)) throw new Error('Cyclic plugin MCP schema')
      ancestry.add(value)
      for (const [key, child] of Object.entries(value)) {
        if (forbiddenKeys.has(key)) throw new Error('Unsafe plugin MCP property')
        characters += key.length; bound(child, depth + 1)
      }
      ancestry.delete(value)
    } else if (value !== null && typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))) throw new Error('Plugin MCP schema must be JSON')
    if (characters > 32768) throw new Error('Plugin MCP schema is too large')
  }
  bound(input, 0)
  let nodes = 0
  const seen = new WeakSet<object>()
  function visit(value: unknown, depth: number): Record<string, unknown> {
    if (++nodes > 256 || depth > 8 || !value || typeof value !== 'object' || Array.isArray(value) || seen.has(value)) throw new Error('Invalid or excessive plugin MCP schema')
    seen.add(value)
    const source = value as Record<string, unknown>
    let result: Record<string, unknown>
    if (Array.isArray(source.type)) {
      if (source.type.length !== 2 || !source.type.includes('null') || source.enum !== undefined || source.const !== undefined) throw new Error('Only nullable type unions are supported')
      const type = source.type.find(type => type !== 'null')
      result = { anyOf: [visit({ ...source, type }, depth + 1), { type: 'null' }] }
    } else if (source.type === 'object') {
      const parsed = objectSchema.parse(source)
      const entries = Object.entries(parsed.properties)
      if (entries.length > 100 || new Set(parsed.required).size !== parsed.required.length || parsed.required.some(key => !Object.hasOwn(parsed.properties, key))) throw new Error('Invalid plugin MCP object properties')
      result = { ...parsed, properties: Object.fromEntries(entries.map(([key, child]) => {
        if (forbiddenKeys.has(key)) throw new Error('Unsafe plugin MCP property')
        return [key, visit(child, depth + 1)]
      })) }
    } else if (source.type === 'array') {
      const parsed = arraySchema.parse(source)
      if ((parsed.minItems ?? 0) > parsed.maxItems) throw new Error('Invalid plugin MCP array limits')
      result = { ...parsed, items: visit(parsed.items, depth + 1) }
    } else if (source.type === 'string') {
      const parsed = stringSchema.parse(source)
      if ((parsed.minLength ?? 0) > parsed.maxLength || parsed.enum?.some(value => typeof value !== 'string')) throw new Error('Invalid plugin MCP string constraints')
      result = parsed
    } else if (source.type === 'number' || source.type === 'integer') {
      const parsed = numberSchema.parse(source)
      if ((parsed.minimum ?? -Infinity) > (parsed.maximum ?? Infinity) || parsed.enum?.some(value => typeof value !== 'number' || (parsed.type === 'integer' && !Number.isInteger(value)))) throw new Error('Invalid plugin MCP number constraints')
      result = parsed
    } else {
      const parsed = primitiveSchema.parse(source)
      if (parsed.enum?.some(value => parsed.type === 'null' ? value !== null : typeof value !== 'boolean')) throw new Error('Invalid plugin MCP primitive enum')
      result = parsed
    }
    // Zod's converter handles enum/const before type constraints; reject contradictory literals
    // rather than silently dropping string/number bounds during that conversion.
    if (result.enum !== undefined || result.const !== undefined) {
      const { enum: values, const: constant, ...base } = result
      const validator = z.fromJSONSchema(base, { registry: z.registry() })
      for (const literal of [...(values as unknown[] ?? []), ...(constant !== undefined ? [constant] : [])]) {
        if (!validator.safeParse(literal).success) throw new Error('Plugin MCP literal contradicts its type constraints')
      }
      if (constant !== undefined && values !== undefined) {
        if (!(values as unknown[]).includes(constant)) throw new Error('Plugin MCP const contradicts enum')
        delete result.enum
      }
    }
    seen.delete(value)
    return result
  }
  if (input.type !== 'object') throw new Error('Plugin MCP input must be an object schema')
  const bounded = visit(input, 0)
  if (JSON.stringify(bounded).length > 32768) throw new Error('Plugin MCP schema is too large')
  // A private registry avoids accumulating per-request metadata in Zod's global registry.
  return z.fromJSONSchema(bounded, { registry: z.registry() })
}

function assertContribution(pluginId: string, tool: Contribution) {
  if (!tool.name.startsWith(`${pluginId}.`) || !['read', 'draft'].includes(tool.operation) || tool.readOnly !== (tool.operation === 'read')) throw new HttpError('Invalid plugin MCP policy', 403)
}

/** Metadata is per request; loading declarations never starts executable plugin workers. */
export async function collectPluginMcpToolDefinitions(principal: McpPrincipal, reservedNames: ReadonlySet<string> = new Set()): Promise<McpToolDefinition[]> {
  if (principal.authentication !== 'mcp-api-key') throw new HttpError('MCP API-key authentication is required', 401)
  await initializePlugins()
  // MCP keys currently authenticate administrators only; never accept an actor from tool input.
  const actor = { userId: principal.userId, role: 'ADMIN' }
  const definitions: McpToolDefinition[] = []
  for (const registered of pluginRegistry.values()) {
    if (!registered.installed || !registered.enabled) continue
    const { manifest, generation, digest } = registered
    for (const tool of manifest.mcp) {
      if (reservedNames.has(tool.name)) continue
      if (!await canAccessPlugin(boundPluginAccess(registered, tool.access), actor)) continue
      try {
        assertContribution(manifest.id, tool)
        const inputSchema = pluginMcpInputSchema(tool.inputSchema)
        const outputSchema = z.object({ data: z.json() })
        const declaration = JSON.stringify(tool)
        const annotations = { readOnlyHint: tool.readOnly, destructiveHint: false, idempotentHint: tool.readOnly, openWorldHint: false }
        const config = { title: tool.title, description: tool.description, inputSchema, outputSchema, annotations }
        definitions.push({
          ...config, config, name: tool.name, domain: manifest.id,
          risk: tool.operation === 'read' ? 'read' : 'write', idempotency: tool.readOnly ? 'idempotent' : 'unknown', resourcePermissions: [],
          policy: { profile: 'plugin', pluginId: manifest.id, operation: tool.operation },
          handler: async (args, context) => {
            if (context.principal.userId !== principal.userId || context.apiKeyId !== principal.apiKeyId) throw new HttpError('MCP principal changed', 403)
            const current = pluginRegistry.get(manifest.id)
            const liveTool = current?.manifest.mcp.find((candidate: Contribution) => candidate.key === tool.key)
            if (!current?.installed || !current.enabled || current.generation !== generation || current.digest !== digest || !liveTool || JSON.stringify(liveTool) !== declaration) throw new HttpError('Plugin MCP contribution is unavailable or changed', 409)
            assertContribution(manifest.id, liveTool)
            await requirePluginAccess(boundPluginAccess(current, liveTool.access), actor)
            const result = await invokeRegisteredPlugin(current, 'mcp', liveTool.key, { actor: { ...actor }, input: args }, false, liveTool.readOnly)
            const data = toJsonSafe(redactMcpSensitiveFields(result ?? null))
            const structuredContent = { data }
            return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent }
          },
        })
      } catch {
        // One invalid installed contribution must not make the host's static MCP tools unavailable.
        console.warn('[mcp:plugin] Invalid contribution omitted', manifest.id, tool.key)
      }
    }
  }
  const counts = new Map<string, number>()
  for (const definition of definitions) counts.set(definition.name, (counts.get(definition.name) ?? 0) + 1)
  return definitions.filter(definition => counts.get(definition.name) === 1)
}

export async function registerPluginMcpTools(server: McpServer, principal: McpPrincipal, reservedNames?: ReadonlySet<string>) {
  registerMcpToolDefinitions(server, await collectPluginMcpToolDefinitions(principal, reservedNames), principal)
}
