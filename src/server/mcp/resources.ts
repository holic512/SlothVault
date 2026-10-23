/**
 * @file resources.ts
 * @project SlothVault
 * @module MCP Resource Registry
 * @description Registers protected managed-file Resource templates for the stateless administrator MCP server.
 * @logic Revalidate the authenticated principal and resource ownership on every read, and return binary content only through MCP Resource blobs.
 * @dependencies MCP TypeScript SDK, HTTP errors, managed-file services, services/mcp-api-keys
 * @index_tags mcp,resources,registry,extension,administrator
 * @author holic512
 */
import 'server-only'

import { Buffer } from 'node:buffer'

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'

import { BUSINESS_TYPE_CONFIG } from '@/lib/file-business-types'
import { HttpError } from '@/server/http/errors'
import {
  collectMcpResourceDefinitions,
  MCP_RESOURCE_FILE_NAME_META_KEY,
  registerMcpResourceDefinitions,
  type McpResourceDefinition,
} from '@/server/mcp/registry'
import { parseJsonDecimalId } from '@/server/services/admin-catalog'
import { managedFileContentType, readManagedFile } from '@/server/services/admin-files'
import type { McpPrincipal } from '@/server/services/mcp-api-keys'

import resourceCatalog from './resource-catalog.json'

/** Converts one Resource template variable into a validated database identifier. */
function resourceId(value: string | string[], label: string) {
  if (Array.isArray(value)) throw new HttpError(`Invalid ${label}`, 400, 400)
  return parseJsonDecimalId(value, label)
}

/** Resolves one required Resource catalog entry. */
function resourceCatalogEntry(name: string) {
  const entry = resourceCatalog.find((item) => item.name === name)
  if (!entry) throw new Error(`Missing MCP Resource catalog entry: ${name}`)
  return entry
}

const managedFileResource = resourceCatalogEntry('managed-file')

/** Contains the protected administrator Resource declaration list. */
export const adminMcpResourceDefinitions: McpResourceDefinition[] = collectMcpResourceDefinitions((server) => {
  server.defineResource(
    managedFileResource.name,
    new ResourceTemplate(managedFileResource.uriTemplate, { list: undefined }),
    {
      title: 'SlothVault 托管文件',
      description: '读取一个有效的托管文件。',
    },
    {
      uriTemplate: managedFileResource.uriTemplate,
      resourceGroup: managedFileResource.resourceGroup as McpResourceDefinition['resourceGroup'],
      mimeType: managedFileResource.mimeType,
      maxNameLength: managedFileResource.maxNameLength,
      maxBytes: managedFileResource.maxBytes,
    },
    async (uri, { id }) => {
      const { file, buffer } = await readManagedFile(resourceId(id, 'fileId'))
      if (!Object.hasOwn(BUSINESS_TYPE_CONFIG, file.businessType)) {
        throw new HttpError('Unsupported managed file classification', 403, 403)
      }
      return {
        contents: [{
          uri: uri.href,
          mimeType: managedFileContentType(file.originalName),
          blob: Buffer.from(buffer).toString('base64'),
          _meta: { [MCP_RESOURCE_FILE_NAME_META_KEY]: file.originalName },
        }],
      }
    },
  )

})

/** Registers all protected Resources through the shared declaration adapter. */
export function registerAdminMcpResources(
  server: Parameters<typeof registerMcpResourceDefinitions>[0],
  principal: McpPrincipal,
) {
  registerMcpResourceDefinitions(server, adminMcpResourceDefinitions, principal)
}
