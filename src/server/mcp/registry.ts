/**
 * @file registry.ts
 * @project SlothVault
 * @module MCP Declaration Registry
 * @description Defines the declaration model and the only SDK registration adapters used by MCP Tools and Resources.
 * @logic Domain modules record declarations without depending on the SDK server instance; the adapter performs one consistent request pipeline before calling the SDK.
 * @dependencies MCP TypeScript SDK, zod, MCP API-key principal
 * @index_tags mcp,registry,contract,context,policy,audit
 * @author MengJiaXu
 */
import 'server-only'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import type {
  McpServer,
  ResourceMetadata,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js'
import type {
  CallToolResult,
  ReadResourceResult,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js'
import { z, type ZodType } from 'zod'

import { HttpError } from '@/server/http/errors'
import type { McpPrincipal } from '@/server/services/mcp-api-keys'

import { mcpErrorResult } from './tools/common'

export type McpRisk = 'read' | 'write' | 'sensitive'
export type McpIdempotency = 'idempotent' | 'non-idempotent' | 'unknown'
export const MCP_RESOURCE_FILE_NAME_META_KEY = 'slothvault/file-name'

type McpOutputSchema = ZodType<Record<string, unknown>>

export interface McpRequestContext {
  principal: McpPrincipal
  apiKeyId: number
  requestId: string
  startedAt: Date
  abortSignal: AbortSignal
}

export interface McpToolMetadata {
  domain: string
  risk: McpRisk
  idempotency: McpIdempotency
  resourcePermissions: string[]
}

export interface McpToolConfig {
  title: string
  description: string
  inputSchema: ZodType
  outputSchema: McpOutputSchema
  annotations?: ToolAnnotations
}

export interface McpToolDefinition extends McpToolMetadata {
  name: string
  title: string
  description: string
  inputSchema: ZodType
  outputSchema: McpOutputSchema
  annotations?: ToolAnnotations
  config: McpToolConfig
  handler: (args: Record<string, unknown>, context: McpRequestContext) => Promise<CallToolResult>
}

export interface McpToolDefinitionRecorder {
  defineTool<TInput extends ZodType = ZodType>(
    name: string,
    config: Omit<McpToolConfig, 'inputSchema'> & { inputSchema: TInput },
    handler: (args: z.infer<TInput>, context: McpRequestContext) => Promise<CallToolResult>,
  ): void
}

export interface McpResourceDefinition {
  name: string
  template: ResourceTemplate
  config: ResourceMetadata
  uriTemplate: string
  resourceGroup: 'managed-file' | 'contract-attachment'
  mimeType: string
  maxNameLength: number
  maxBytes: number
  handler: (
    uri: URL,
    variables: Record<string, string | string[]>,
    context: McpRequestContext,
  ) => Promise<ReadResourceResult>
}

export interface McpResourceDefinitionRecorder {
  defineResource(
    name: string,
    template: ResourceTemplate,
    config: ResourceMetadata,
    metadata: Pick<
      McpResourceDefinition,
      'uriTemplate' | 'resourceGroup' | 'mimeType' | 'maxNameLength' | 'maxBytes'
    >,
    handler: McpResourceDefinition['handler'],
  ): void
}

export type McpAuditEvent = {
  requestId: string
  apiKeyId: number
  principalUserId: number
  kind: 'tool' | 'resource'
  name: string
  startedAt: string
  completedAt: string
  ok: boolean
}

type AuditSink = (event: McpAuditEvent) => void | Promise<void>

let auditSink: AuditSink = (event) => {
  console.info('[mcp:audit]', JSON.stringify(event))
}

/** Installs the process-local audit hook used by the MCP execution pipeline. */
export function setMcpAuditSink(sink: AuditSink) {
  auditSink = sink
}

/** Creates a request context from the authenticated principal and SDK callback metadata. */
export function createMcpRequestContext(
  principal: McpPrincipal,
  extra: { requestId?: unknown; signal?: AbortSignal } | undefined,
): McpRequestContext {
  return {
    principal,
    apiKeyId: principal.apiKeyId,
    requestId: typeof extra?.requestId === 'string'
      ? extra.requestId
      : String(extra?.requestId ?? randomUUID()),
    startedAt: new Date(),
    abortSignal: extra?.signal ?? new AbortController().signal,
  }
}

/** Records one tool declaration without creating an SDK registration. */
export function collectMcpToolDefinitions(
  register: (recorder: McpToolDefinitionRecorder) => void,
): McpToolDefinition[] {
  const definitions: McpToolDefinition[] = []
  const recorder: McpToolDefinitionRecorder = {
    defineTool(name, config, handler) {
      definitions.push({
        name,
        title: config.title,
        description: config.description,
        inputSchema: config.inputSchema,
        outputSchema: config.outputSchema,
        annotations: config.annotations,
        config,
        handler: async (args, context) => handler(args as z.infer<typeof config.inputSchema>, context),
        ...inferToolMetadata(name, config.annotations),
      })
    },
  }
  register(recorder)
  return definitions
}

/** Registers all declarations through the single SDK adapter and execution pipeline. */
export function registerMcpToolDefinitions(
  server: McpServer,
  definitions: McpToolDefinition[],
  principal: McpPrincipal,
) {
  validateToolDefinitions(definitions)
  for (const definition of definitions) {
    server.registerTool(
      definition.name,
      definition.config,
      async (args, extra) => {
        const context = createMcpRequestContext(principal, extra)
        try {
          return await executeMcpOperation('tool', definition.name, context, async () => {
            const result = await executeToolDefinition(definition, args as Record<string, unknown>, context)
            return normalizeToolResult(result, definition)
          })
        } catch (error) {
          return mcpErrorResult(error, definition.name)
        }
      },
    )
  }
}

/** Validates required declaration fields before exposing the registry to MCP clients. */
function validateToolDefinitions(definitions: McpToolDefinition[]) {
  assertUniqueNames(definitions.map((definition) => definition.name), 'Tool')
  for (const definition of definitions) {
    if (!definition.domain || !definition.risk || !definition.idempotency) {
      throw new Error(`Tool metadata is incomplete: ${definition.name}`)
    }
    if (
      definition.resourcePermissions.some((permission) =>
        !['managed-file:read', 'contract-attachment:read'].includes(permission))
    ) {
      throw new Error(`Tool Resource permission is invalid: ${definition.name}`)
    }
    if (!definition.inputSchema || !definition.outputSchema) {
      throw new Error(`Tool schema declaration is incomplete: ${definition.name}`)
    }
    if (typeof definition.handler !== 'function') {
      throw new Error(`Tool handler is missing: ${definition.name}`)
    }
  }
}

/** Records one Resource declaration without creating an SDK registration. */
export function collectMcpResourceDefinitions(
  register: (recorder: McpResourceDefinitionRecorder) => void,
): McpResourceDefinition[] {
  const definitions: McpResourceDefinition[] = []
  const recorder: McpResourceDefinitionRecorder = {
    defineResource(name, template, config, metadata, handler) {
      definitions.push({ name, template, config, ...metadata, handler })
    },
  }
  register(recorder)
  return definitions
}

/** Registers all Resource declarations through the same authorization, size, and audit pipeline as Tools. */
export function registerMcpResourceDefinitions(
  server: McpServer,
  definitions: McpResourceDefinition[],
  principal: McpPrincipal,
) {
  validateResourceDefinitions(definitions)
  for (const definition of definitions) {
    server.registerResource(
      definition.name,
      definition.template,
      { ...definition.config, mimeType: definition.mimeType },
      async (uri, variables, extra) => {
        const context = createMcpRequestContext(principal, extra)
        try {
          return await executeMcpOperation('resource', definition.name, context, async () => {
            assertResourcePolicy(definition, context)
            const result = await definition.handler(uri as URL, variables as Record<string, string | string[]>, context)
            validateResourceResult(result, definition)
            return result
          })
        } catch (error) {
          throw mapResourceError(error, definition.name)
        }
      },
    )
  }
}

/** Validates Resource identity, authorization group, MIME, filename, and payload limits. */
function validateResourceDefinitions(definitions: McpResourceDefinition[]) {
  assertUniqueNames(definitions.map((definition) => definition.name), 'Resource')
  assertUniqueNames(definitions.map((definition) => definition.uriTemplate), 'Resource URI template')
  for (const definition of definitions) {
    if (!['managed-file', 'contract-attachment'].includes(definition.resourceGroup)) {
      throw new Error(`Unknown MCP Resource group: ${definition.resourceGroup}`)
    }
    if (!definition.mimeType || definition.maxNameLength < 1 || definition.maxBytes < 1) {
      throw new Error(`Resource contract is incomplete: ${definition.name}`)
    }
  }
}

/** Executes one operation, maps unexpected failures at the adapter boundary, and emits an audit event. */
async function executeMcpOperation<T>(
  kind: 'tool' | 'resource',
  name: string,
  context: McpRequestContext,
  operation: () => Promise<T>,
): Promise<T> {
  let ok = false
  try {
    if (context.abortSignal.aborted) throw new Error('MCP request aborted')
    const result = await operation()
    ok = !(kind === 'tool' && Boolean((result as CallToolResult).isError))
    return result
  } finally {
    try {
      await auditSink({
        requestId: context.requestId,
        apiKeyId: context.apiKeyId,
        principalUserId: context.principal.userId,
        kind,
        name,
        startedAt: context.startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        ok,
      })
    } catch (error) {
      console.error('[mcp:audit] Audit hook failed', error)
    }
  }
}

/** Infers stable declaration metadata from the existing names and SDK safety annotations. */
function inferToolMetadata(name: string, annotations?: ToolAnnotations): McpToolMetadata {
  const parts = name.split('.')
  const domain = parts.slice(0, -1).join('.') || 'unknown'
  const risk: McpRisk = annotations?.readOnlyHint ? 'read' : 'write'
  const idempotency: McpIdempotency = annotations?.idempotentHint ? 'idempotent' : 'non-idempotent'
  const resourcePermissions = name === 'content.file.get'
    ? ['managed-file:read']
    : name === 'admin.contract.attachment.get'
      ? ['contract-attachment:read']
      : []
  return { domain, risk, idempotency, resourcePermissions }
}

/** Ensures a registry cannot expose ambiguous names. */
function assertUniqueNames(names: string[], kind: string) {
  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) throw new Error(`${kind} name is registered more than once: ${name}`)
    seen.add(name)
  }
}

/** Verifies Resource MIME and encoded payload limits before returning bytes to the SDK. */
function validateResourceResult(
  result: Awaited<ReturnType<McpResourceDefinition['handler']>>,
  definition: McpResourceDefinition,
) {
  for (const content of result.contents) {
    const fileName = content._meta?.[MCP_RESOURCE_FILE_NAME_META_KEY]
    if (
      typeof fileName !== 'string' ||
      !fileName ||
      fileName.length > definition.maxNameLength ||
      /[\\/\0]/.test(fileName)
    ) {
      throw new Error(`Resource filename is invalid for ${definition.name}`)
    }
    if (
      definition.resourceGroup === 'contract-attachment' &&
      content.mimeType &&
      content.mimeType !== definition.mimeType
    ) {
      throw new Error(`Resource MIME type mismatch for ${definition.name}`)
    }
    if (!content.mimeType) throw new Error(`Resource MIME type is missing for ${definition.name}`)
    if ('blob' in content && Buffer.byteLength(content.blob, 'base64') > definition.maxBytes) {
      throw new Error(`Resource exceeds the configured size limit for ${definition.name}`)
    }
  }
}

/** Applies declaration-level risk and authorization policy before invoking a Tool Handler. */
async function executeToolDefinition(
  definition: McpToolDefinition,
  args: Record<string, unknown>,
  context: McpRequestContext,
) {
  assertToolPolicy(definition, context)
  return definition.handler(args, context)
}

/** Rejects high-risk names and non-MCP principals even if a declaration is accidentally added later. */
function assertToolPolicy(definition: McpToolDefinition, context: McpRequestContext) {
  if (context.principal.authentication !== 'mcp-api-key') {
    throw new HttpError('MCP API-key authentication is required', 401, 401)
  }
  if (/(?:^|\.)(?:delete|restore|publish|withdraw|revoke|batch|reset|backup)$/.test(definition.name)) {
    throw new HttpError(`Tool is blocked by MCP risk policy: ${definition.name}`, 403, 403)
  }
}

/** Keeps the two Resource security domains explicitly separated at the adapter boundary. */
function assertResourcePolicy(definition: McpResourceDefinition, context: McpRequestContext) {
  if (context.principal.authentication !== 'mcp-api-key') {
    throw new HttpError('MCP API-key authentication is required', 401, 401)
  }
  if (!['managed-file', 'contract-attachment'].includes(definition.resourceGroup)) {
    throw new HttpError(`Unknown MCP Resource group: ${definition.resourceGroup}`, 403, 403)
  }
}

/** Validates and serializes structured Tool output so adapters never leak service-only fields. */
function normalizeToolResult(result: CallToolResult, definition: McpToolDefinition): CallToolResult {
  const outputSchema = definition.outputSchema
  if (result.isError || !outputSchema || result.structuredContent === undefined) return result
  const parsed = outputSchema.safeParse(result.structuredContent)
  if (!parsed.success) throw new Error(`MCP output contract violation for ${definition.name}`)
  return {
    ...result,
    content: [{ type: 'text', text: JSON.stringify(parsed.data) }],
    structuredContent: parsed.data,
  }
}

/** Preserves documented Resource errors while hiding unexpected implementation details. */
function mapResourceError(error: unknown, resourceName: string) {
  if (error instanceof HttpError) return error
  console.error(`[mcp:${resourceName}] Resource execution failed`, error)
  return new Error('Internal server error')
}
