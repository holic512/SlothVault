/**
 * @file resources.ts
 * @project SlothVault
 * @module MCP Resource Registry
 * @description Registers protected managed-file and contract-attachment Resource templates for the stateless administrator MCP server.
 * @logic Revalidate the authenticated principal and resource ownership on every read, keep contract attachments off public URLs, and return binary content only through MCP Resource blobs.
 * @dependencies MCP TypeScript SDK, HTTP errors, managed-file and contract services, services/mcp-api-keys
 * @index_tags mcp,resources,registry,extension,administrator
 * @author holic512
 */
import 'server-only'

import { Buffer } from 'node:buffer'

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'

import { HttpError } from '@/server/http/errors'
import {
  collectMcpResourceDefinitions,
  MCP_RESOURCE_FILE_NAME_META_KEY,
  registerMcpResourceDefinitions,
  type McpResourceDefinition,
} from '@/server/mcp/registry'
import { parseJsonDecimalId } from '@/server/services/admin-catalog'
import { managedFileContentType, readManagedFile } from '@/server/services/admin-files'
import { readAuthorizedContractAttachment } from '@/server/services/contracts'
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
const contractAttachmentResource = resourceCatalogEntry('contract-attachment')

/** Contains the protected administrator Resource declaration list. */
export const adminMcpResourceDefinitions: McpResourceDefinition[] = collectMcpResourceDefinitions((server) => {
  server.defineResource(
    managedFileResource.name,
    new ResourceTemplate(managedFileResource.uriTemplate, { list: undefined }),
    {
      title: 'SlothVault 托管文件',
      description: '读取一个有效的非合同托管文件。',
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
      if (file.businessType === 'ContractAttachment') {
        throw new HttpError('Contract attachments require the protected contract resource', 403, 403)
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

  server.defineResource(
    contractAttachmentResource.name,
    new ResourceTemplate(contractAttachmentResource.uriTemplate, { list: undefined }),
    {
      title: 'SlothVault 合同附件',
      description: '通过当前管理员身份读取一个私有合同 PDF 附件。',
      mimeType: 'application/pdf',
    },
    {
      uriTemplate: contractAttachmentResource.uriTemplate,
      resourceGroup: contractAttachmentResource.resourceGroup as McpResourceDefinition['resourceGroup'],
      mimeType: contractAttachmentResource.mimeType,
      maxNameLength: contractAttachmentResource.maxNameLength,
      maxBytes: contractAttachmentResource.maxBytes,
    },
    async (uri, { contractId }, context) => {
      const attachment = await readAuthorizedContractAttachment({
        id: resourceId(contractId, 'contractId'),
        userId: context.principal.userId,
        isAdmin: true,
      })
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/pdf',
          blob: Buffer.from(attachment.buffer).toString('base64'),
          _meta: { [MCP_RESOURCE_FILE_NAME_META_KEY]: attachment.originalName },
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
