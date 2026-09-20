/**
 * @file files.ts
 * @project SlothVault
 * @module MCP File Tools
 * @description Registers MCP 3.0 managed-file metadata and single-file base64 upload tools.
 * @logic Keep file metadata reads safe, decode bounded base64 before delegating to the existing file validator, and return Resource URIs instead of file bytes.
 * @dependencies MCP TypeScript SDK, zod, node:buffer, admin catalog/files services, HTTP errors, MCP tool contracts
 * @index_tags mcp,tools,file,upload,base64,resource
 * @author MengJiaXu
 */
import 'server-only'

import { Buffer } from 'node:buffer'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { HttpError } from '@/server/http/errors'
import {
  AVATAR_FILE_MAX_BYTES,
  GENERAL_FILE_MAX_BYTES,
  getAdminFile,
  listAdminFiles as listFiles,
  uploadAdminFileBuffer,
} from '@/server/services/admin-files'

import {
  CREATE_ANNOTATIONS,
  decimalIdSchema,
  isoDateSchema,
  mcpId,
  pageSchema,
  pageSizeSchema,
  paginationOutputShape,
  READ_ONLY_ANNOTATIONS,
  runMcpTool,
} from './common'

const contentBusinessTypes = [
  'ProjectAvatar',
  'ArticleCover',
  'ArticleAttachment',
  'NoteAttachment',
  'HomeworkFile',
  'Markdown',
  'Other',
] as const

const businessTypeSchema = z.enum(contentBusinessTypes)

const fileOutputSchema = z.object({
  id: decimalIdSchema,
  originalName: z.string(),
  fileName: z.string(),
  filePath: z.string(),
  fileSize: z.string(),
  businessType: z.string(),
  status: z.number().int(),
  createTime: isoDateSchema,
})

/** Removes legacy public download URLs from MCP file metadata. */
function mcpFileMetadata<T extends { url?: unknown }>(file: T) {
  const { url: _url, ...metadata } = file
  return metadata
}

/** Returns the longest canonical base64 string that can decode within the byte limit. */
function maxEncodedLength(maxBytes: number) {
  return Math.ceil(maxBytes / 3) * 4
}

/** Validates and decodes one canonical base64 payload without exceeding the file limit. */
function decodeBase64(value: string, maxBytes: number) {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new HttpError('contentBase64 must be standard base64', 400, 400)
  }
  if (value.length > maxEncodedLength(maxBytes)) {
    throw new HttpError('Encoded file exceeds the maximum size', 413, 413)
  }
  const buffer = Buffer.from(value, 'base64')
  if (buffer.length === 0 || buffer.length > maxBytes) {
    throw new HttpError('Decoded file exceeds the maximum size', 413, 413)
  }
  return buffer
}

export function registerFileTools(server: McpServer) {
  server.registerTool(
    'content.file.list',
    {
      title: '列出托管文件',
      description: '分页读取有效托管文件元数据，不返回文件内容。该工具只读。',
      inputSchema: z.strictObject({
        page: pageSchema,
        pageSize: pageSizeSchema,
        keyword: z.string().trim().max(120).default(''),
        businessType: z.string().trim().max(64).optional(),
      }),
      outputSchema: z.object({ list: z.array(fileOutputSchema), ...paginationOutputShape }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ page, pageSize, keyword, businessType }) => runMcpTool('content.file.list', async () => {
      const result = await listFiles({
        page,
        pageSize,
        skip: (page - 1) * pageSize,
        keyword: keyword.trim(),
        businessType,
        includeDeleted: false,
        orderByField: 'createTime',
        order: 'desc',
      })
      return { ...result, list: result.list.map(mcpFileMetadata) }
    }),
  )

  server.registerTool(
    'content.file.get',
    {
      title: '读取托管文件元数据',
      description: '读取托管文件元数据并返回受保护的 Resource URI，不返回文件内容。该工具只读。',
      inputSchema: z.strictObject({ fileId: decimalIdSchema }),
      outputSchema: fileOutputSchema.extend({ resourceUri: z.string() }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ fileId }) => runMcpTool('content.file.get', async () => {
      const file = await getAdminFile(mcpId(fileId, 'fileId'))
      if (file.businessType === 'ContractAttachment') {
        throw new HttpError('Contract attachments require the contract Resource', 403, 403)
      }
      return {
        ...mcpFileMetadata(file),
        resourceUri: `slothvault://managed-file/${file.id}`,
      }
    }),
  )

  server.registerTool(
    'content.file.upload',
    {
      title: '上传托管文件',
      description: '上传一个受限内容文件并返回受保护 Resource URI；不允许系统、用户头像或合同附件类型。',
      inputSchema: z.strictObject({
        originalName: z.string().trim().min(1).max(255),
        businessType: businessTypeSchema,
        contentBase64: z.string().min(4),
      }),
      outputSchema: fileOutputSchema.extend({ resourceUri: z.string() }),
      annotations: CREATE_ANNOTATIONS,
    },
    async ({ originalName, businessType, contentBase64 }) =>
      runMcpTool('content.file.upload', async () => {
        const maxBytes = businessType === 'ProjectAvatar'
          ? AVATAR_FILE_MAX_BYTES
          : GENERAL_FILE_MAX_BYTES
        const buffer = decodeBase64(contentBase64, maxBytes)
        const file = await uploadAdminFileBuffer({ originalName, businessType, buffer })
        return {
          ...mcpFileMetadata(file),
          resourceUri: `slothvault://managed-file/${file.id}`,
        }
      }),
  )
}
