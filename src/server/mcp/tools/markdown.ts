/**
 * @file markdown.ts
 * @project SlothVault
 * @module MCP Markdown Capabilities
 * @description Exposes the same data-only extension capabilities and static diagnostics as the website.
 * @logic Describe supported authoring presets and validate text without rendering, network access or writes.
 * @dependencies markdown contract and processor, MCP registry
 * @index_tags mcp,markdown,capabilities,validation
 * @author holic512
 */
import 'server-only'
import { z } from 'zod'
import { markdownCapabilities, markdownLimits } from '@/lib/markdown/contract'
import { validateMarkdown } from '@/lib/markdown/processor'
import { collectMcpToolDefinitions } from '@/server/mcp/registry'
import { READ_ONLY_ANNOTATIONS, runMcpTool } from './common'

export const markdownToolDefinitions = collectMcpToolDefinitions(server => {
  server.defineTool(
    'content.markdown.capabilities',
    { title: 'Markdown 扩展能力', description: '查询本站支持的 Markdown 扩展、参数 JSON Schema、预设和限制。生成高级内容前按需查询；不授权写入或发布。', inputSchema: z.strictObject({ extensionId: z.enum(['echarts', 'counter', 'motion', 'callout', 'details', 'columns', 'timeline', 'steps', 'tabs', 'tab', 'mermaid']).optional() }), outputSchema: z.object({ version: z.string(), limits: z.record(z.string(), z.number()), chartTypes: z.array(z.string()), restrictions: z.array(z.string()), images: z.object({ thumbnail: z.string(), original: z.string() }), extensions: z.array(z.object({ id: z.string(), syntax: z.string(), schema: z.record(z.string(), z.json()), presets: z.array(z.object({ id: z.string(), extension: z.string(), category: z.string(), label: z.string(), source: z.string() })), fallback: z.string() })) }), annotations: READ_ONLY_ANNOTATIONS },
    async ({ extensionId }) => runMcpTool('content.markdown.capabilities', async () => markdownCapabilities(extensionId)),
  )
  server.defineTool(
    'content.markdown.validate',
    { title: '校验 Markdown 扩展', description: '静态检查扩展语法、JSON 配置、额度与危险字段，返回行列诊断。不渲染、不检查外部资源，不证明视觉或技术内容正确。', inputSchema: z.strictObject({ content: z.string().max(markdownLimits.content) }), outputSchema: z.object({ valid: z.boolean(), issues: z.array(z.object({ level: z.enum(['error', 'warning']), code: z.string(), line: z.number(), column: z.number(), extensionId: z.string(), message: z.string() })) }), annotations: READ_ONLY_ANNOTATIONS },
    async ({ content }) => runMcpTool('content.markdown.validate', async () => validateMarkdown(content)),
  )
})
