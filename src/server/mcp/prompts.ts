/**
 * @file prompts.ts
 * @project SlothVault
 * @module MCP Workflow Prompts
 * @description Registers reusable administrator workflows for creating project drafts, organizing notes, and checking publication readiness.
 * @logic Return direct-execution instructions that reference only registered MCP tools, respect immutable releases, stop on exact project-name conflicts, and never publish or delete content.
 * @dependencies MCP TypeScript SDK, zod, mcp tool contracts
 * @index_tags mcp,prompts,workflow,project-draft,note-organization,preflight
 * @author holic512
 */
import 'server-only'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { decimalIdSchema } from './tools/common'

function workflowMessage(text: string) {
  return {
    messages: [{
      role: 'user' as const,
      content: { type: 'text' as const, text },
    }],
  }
}

export function registerAdminMcpPrompts(server: McpServer) {
  server.registerPrompt(
    'workflow.create_project_draft',
    {
      title: '创建项目草稿',
      description: '创建项目、版本草稿，并可按提纲建立分类、笔记和正文。',
      argsSchema: {
        projectName: z.string().trim().min(1).max(128),
        version: z.string().trim().min(1).max(64),
        description: z.string().optional(),
        outline: z.string().optional(),
      },
    },
    ({ projectName, version, description, outline }) => workflowMessage(`
请直接执行 SlothVault 项目草稿创建工作流；MCP 客户端如配置了逐次 Tool 审批，则遵循客户端审批。

目标：
- 项目名称：${JSON.stringify(projectName)}
- 版本标签：${JSON.stringify(version)}
- 版本说明：${description === undefined ? '未提供' : JSON.stringify(description)}
- 结构化提纲：${outline === undefined ? '未提供' : JSON.stringify(outline)}

执行规则：
1. 调用 project.list，以项目名称为 keyword 分页检查所有匹配结果；比较时使用去除首尾空白后的精确名称。
2. 如果发现精确同名项目，立即停止并报告冲突，不复用、不修改，也不创建重复项目。
3. 如果没有精确同名项目，调用 project.create 创建项目，再用返回的 projectId 调用 project_version.create_draft 创建空版本草稿；不要传 sourceVersionId。
4. 如果提供了提纲，将其解析为分类、笔记和 Markdown 正文，依次调用 category.create、note.create、note_content.create_draft。首个正文会自动成为主正文；不要另行创建空占位正文。
5. 需要校正草稿时，只可使用 project.update_metadata、category.update、note.update、note_content.update_draft 和 note_content.set_primary_draft。
6. 任一 Tool 失败后立即停止，报告已成功创建的实体 ID 和失败原因，避免继续制造不完整的平行结构。
7. 不调用任何发布、撤回、删除、恢复、批量或可见性操作。完成后汇总项目、版本、分类、笔记和正文 ID；不要声称已经发布。
`.trim()),
  )

  server.registerPrompt(
    'workflow.organize_notes',
    {
      title: '整理笔记草稿',
      description: '读取一个版本草稿的文档树，并按要求创建或更新分类、笔记和正文。',
      argsSchema: {
        projectVersionId: decimalIdSchema,
        requirements: z.string().optional(),
      },
    },
    ({ projectVersionId, requirements }) => workflowMessage(`
请直接整理 SlothVault 项目版本草稿 ${projectVersionId}；MCP 客户端如配置了逐次 Tool 审批，则遵循客户端审批。

整理要求：${requirements === undefined ? '保持清晰的现有结构，修正明显缺失的正文和主版本关系。' : requirements}

执行规则：
1. 先调用 project_version.get；如果版本不存在、已删除或 publishedAt 非 null，立即停止，绝不修改发布版本。
2. 使用 category.list 和 note.list 按 pageSize=50 分页读取该 projectVersionId 的完整未删除结构，直到读取数量覆盖 total。
3. 对每个相关笔记调用 note_content.list_versions；只在确实需要理解或修改正文时调用 note_content.get，避免无谓加载大段历史正文。
4. 根据整理要求，使用 category.create/category.update、note.create/note.update、note_content.create_draft/note_content.update_draft 完成结构和内容调整；需要改变展示正文时单独调用 note_content.set_primary_draft。
5. 优先更新已有实体，只有缺少对应结构时才创建；不得用近似标题猜测合并，不得制造重复分类或笔记。
6. 任一 Tool 返回 VERSION_FROZEN 或其他冲突时立即停止并报告，不继续执行剩余写入。
7. 不删除、不恢复、不发布、不撤回，也不改变发布版本可见性。完成后列出实际修改和新建的实体 ID。
`.trim()),
  )

  server.registerPrompt(
    'workflow.pre_publish_check',
    {
      title: '发布前检查',
      description: '只读检查项目版本草稿能否通过正式发布校验，并解释阻塞问题。',
      argsSchema: {
        projectVersionId: decimalIdSchema,
      },
    },
    ({ projectVersionId }) => workflowMessage(`
请对 SlothVault 项目版本草稿 ${projectVersionId} 执行只读发布前检查。

执行规则：
1. 调用 project_version.get，确认版本存在、未删除且 publishedAt 为 null；否则报告该版本不是可检查的草稿。
2. 调用 project_version.check_draft。ready=true 时报告“当前读取时刻已通过发布就绪校验”；明确说明网页后台正式发布仍会在事务内重新校验。
3. ready=false 时，按 issues 的 code、entity、entityId 和 message 逐项解释。仅为定位问题而调用 project.get、category.list、note.list、note.get、note_content.list_versions 或 note_content.get。
4. 给出按实体 ID 定位的修复建议，但不要调用任何写 Tool 自动修复。
5. 不发布、不撤回、不删除、不恢复，也不改变项目或版本可见性。
`.trim()),
  )
}
