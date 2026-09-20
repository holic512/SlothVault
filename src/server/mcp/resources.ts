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

import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { HttpError } from '@/server/http/errors'
import { parseJsonDecimalId } from '@/server/services/admin-catalog'
import { managedFileContentType, readManagedFile } from '@/server/services/admin-files'
import { readAuthorizedContractAttachment } from '@/server/services/contracts'
import type { McpPrincipal } from '@/server/services/mcp-api-keys'

/** Converts one Resource template variable into a validated database identifier. */
function resourceId(value: string | string[], label: string) {
  if (Array.isArray(value)) throw new HttpError(`Invalid ${label}`, 400, 400)
  return parseJsonDecimalId(value, label)
}

export function registerAdminMcpResources(server: McpServer, principal: McpPrincipal) {
  server.registerResource(
    'managed-file',
    new ResourceTemplate('slothvault://managed-file/{id}', { list: undefined }),
    {
      title: 'SlothVault 托管文件',
      description: '读取一个有效的非合同托管文件。',
    },
    async (uri, { id }) => {
      const { file, buffer } = await readManagedFile(resourceId(id, 'fileId'))
      if (file.businessType === 'ContractAttachment') {
        throw new HttpError('Contract attachments require the protected contract resource', 403, 403)
      }
      return {
        contents: [{
          uri: uri.href,
          name: file.originalName,
          mimeType: managedFileContentType(file.originalName),
          blob: Buffer.from(buffer).toString('base64'),
        }],
      }
    },
  )

  server.registerResource(
    'contract-attachment',
    new ResourceTemplate('slothvault://contract-attachment/{contractId}', { list: undefined }),
    {
      title: 'SlothVault 合同附件',
      description: '通过当前管理员身份读取一个私有合同 PDF 附件。',
      mimeType: 'application/pdf',
    },
    async (uri, { contractId }) => {
      const attachment = await readAuthorizedContractAttachment({
        id: resourceId(contractId, 'contractId'),
        userId: principal.userId,
        isAdmin: true,
      })
      return {
        contents: [{
          uri: uri.href,
          name: attachment.originalName,
          mimeType: 'application/pdf',
          blob: Buffer.from(attachment.buffer).toString('base64'),
        }],
      }
    },
  )
}
