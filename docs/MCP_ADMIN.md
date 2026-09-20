# 管理员 MCP 接入

SlothVault 在现有 Web 应用中提供单一的管理员 MCP Streamable HTTP 入口：

```text
POST https://<你的 SlothVault 域名>/mcp
```

该入口仅接受通过管理员 MCP Key 认证的请求。它不接受、也不会回退到浏览器的 `sv_session` Cookie。

## 创建与管理 MCP Key

MCP Key 管理 API 均位于现有管理员 API 下，并要求普通管理员网页登录 Session：

| 操作 | HTTP 接口 |
| --- | --- |
| 列出当前管理员的 Key | `GET /api/admin/mm/mcp/keys` |
| 创建 Key | `POST /api/admin/mm/mcp/keys` |
| 启用 / 禁用 Key | `PATCH /api/admin/mm/mcp/keys/<id>` |
| 删除 Key | `DELETE /api/admin/mm/mcp/keys/<id>` |

创建请求接受以下 JSON：

```json
{
  "name": "Codex 工作区",
  "expiresAt": "2026-12-31T00:00:00.000Z"
}
```

`expiresAt` 可省略或设为 `null`，表示 Key 不设置到期时间。创建响应会在 `data.key` 中返回完整 Key；这是唯一一次返回明文 Key。后续查询只返回 Key 名称、脱敏提示、状态、创建时间、到期时间和最后使用时间。

## MCP 客户端配置

将完整 Key 配置为 MCP 客户端请求 `/mcp` 时的 Bearer 凭据：

```http
Authorization: Bearer svmcp_<public-id>.<secret>
```

服务端只存储 `<secret>` 的 Argon2id 哈希。每次 MCP 请求都会重新检查：

1. Key 格式、状态和过期时间；
2. Key 所属账号仍是启用状态；
3. Key 所属账号仍具备 `ADMIN` 角色。

任一检查失败都会返回 HTTP `401` 和 MCP JSON-RPC 未认证错误。禁用或删除 Key 在下一次外部 MCP 请求时立即生效。

## MCP 3.0 Tool

MCP server identity 为 `slothvault-admin-mcp@3.0.0`。3.0 使用点号分层命名，所有 2.0 Tool 名称均已停用且不保留别名；升级后应同步修改客户端保存的 Tool 名称。当前注册表共 55 个 Tool。

完整 Tool/Resource 清单、领域、风险、幂等性、URI、文件名和大小上限由注册表生成：[MCP Registry 清单](./MCP_REGISTRY.md)。修改 `src/server/mcp/tools/` 或 `src/server/mcp/resource-catalog.json` 后运行 `npm run mcp:docs`；CI 使用 `npm run mcp:docs:check` 阻止文档过期。

面向 SlothTool MCP Client 的端到端调用范例、人工交接边界和 Skill 设计约束见：[SlothTool MCP Client 全场景操作与 Skill 设计指南](./SLOTHTOOL_MCP_WORKFLOW_GUIDE.md)。

所有 ID 参数都必须是正十进制字符串，例如：

```json
{
  "projectVersionId": "12"
}
```

列表 Tool 的默认分页为 `page=1`、`pageSize=20`，单页最多 50 条。成功结果同时提供 JSON 文本和 `structuredContent`，不会添加网页 API 的 `{code,message,data}` 外壳。

从已发布版本创建草稿的示例：

调用 `content.project.version.clone`：

```json
{
  "projectId": "9",
  "sourceVersionId": "11",
  "version": "2.0",
  "description": "下一版本草稿"
}
```

`sourceVersionId` 必须属于 `projectId` 指定的同一项目，且来源必须已经发布、未删除。省略 `description` 或 `weight` 时沿用来源。若需要创建空草稿，应改调用 `content.project.version.create_draft`，默认说明为 `null`、权重为 `0`。

### 文件上传与受保护 Resource

`content.file.upload` 每次只接受一个文件，输入固定为：

```json
{
  "originalName": "guide.md",
  "businessType": "Markdown",
  "contentBase64": "..."
}
```

允许的 `businessType` 为 `ProjectAvatar`、`ArticleCover`、`ArticleAttachment`、`NoteAttachment`、`HomeworkFile`、`Markdown` 和 `Other`。`SystemLogo`、`SystemFavicon`、`UserAvatar`、`ContractAttachment` 不允许通过 MCP 上传。服务端会在 Base64 解码前检查编码长度，并继续复用文件名、扩展名、图片格式、Sharp 校验、路径安全和数据库事务；头像类文件限制 2 MB，普通文件限制 10 MB。普通 Tool 结果只返回文件元数据和 Resource URI，不嵌入大文件 Base64，也不返回旧的公共下载 URL。

受保护 Resource URI 为：

```text
slothvault://managed-file/{id}
slothvault://contract-attachment/{contractId}
```

每次 `resources/read` 都会重新验证当前 MCP Key。托管文件 Resource 只读取状态有效且非合同附件的文件；合同附件 Resource 通过合同授权 Service 返回原始文件名、`application/pdf` 和 blob，不暴露合同附件公共 URL。已删除、失效、缺失或业务类型不匹配的文件会返回受控错误。

Resource 内容遵循标准 MCP `ReadResourceResult`：二进制数据位于 `blob`，原始文件名位于 `_meta["slothvault/file-name"]`，不使用非标准的顶层 `name` 字段。

## 工作流 Prompt

| Prompt | 用途 |
| --- | --- |
| `workflow.create_project_draft` | 检查精确同名项目，然后创建项目、版本草稿，并可按提纲建立分类、笔记和正文。 |
| `workflow.organize_notes` | 读取现有草稿树，按要求创建或更新分类、笔记、正文和主正文。 |
| `workflow.pre_publish_check` | 调用只读预检，解释阻塞问题并给出按实体 ID 定位的修复建议。 |

Prompt 返回给 MCP 客户端模型的是标准化执行指令，不会由服务端自行递归调用 Tool，也不增加工作流级二次确认。实际 Tool 是否逐次审批由 MCP 客户端决定。

## 草稿与发布边界

项目版本一旦发布，版本本身及其分类、笔记、正文即被冻结。所有文档树写 Tool 都调用与网页后台相同的 Service、可串行化事务和版本锁；遇到发布版本会返回 `VERSION_FROZEN`，不会绕过业务规则或部分写入。

`content.project.update` 有一个明确例外：已有发布版本的项目仍可调整权重，这可能立即改变公开排序；名称和头像必须在网页后台修改。含名称或头像的混合更新会整体失败，不会只应用其中的权重。

`content.project.version.check_draft` 检查父项目状态、启用分类、启用笔记、唯一未删除主正文、主正文启用状态和非空正文。结果仅代表本次读取时刻；网页后台正式发布时会在事务中重新执行同一校验。

MCP 不注册项目、版本、分类、笔记、正文、文章、首页、菜单和文件的删除/恢复 Tool，也不注册发布、撤回、批量操作、版本可见性调整、密码重置、积分调整、卡密发行、会员授予/撤销、合同写入、链上提交、备份恢复、系统设置写入或系统更新执行 Tool。上述高风险操作继续由网页后台确认；后续如开放 MCP 发布，应采用独立的两段式确认协议。

Tool、Prompt 与 Resource 注册分别位于 `src/server/mcp/tools/`、`src/server/mcp/prompts.ts` 和 `src/server/mcp/resources.ts`，均复用 `/mcp` 的 MCP Key 鉴权边界。
