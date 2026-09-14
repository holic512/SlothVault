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

## MCP 2.0 Tool

MCP server identity 为 `slothvault-admin-mcp@2.0.0`。2.0 将原有 `admin_project_list` 直接替换为 `project.list`，不保留旧名；升级后应同步修改客户端保存的 Tool 名称。

| 领域 | Tool | 作用 |
| --- | --- | --- |
| 项目 | `project.list` | 分页读取未删除项目和最新已发布版本摘要。 |
| 项目 | `project.get` | 读取一个项目的完整管理员元数据。 |
| 项目 | `project.create` | 创建 `status=1` 的项目外壳；没有发布版本时不会公开。 |
| 项目 | `project.update_metadata` | 更新名称、头像或权重；已有发布版本时只允许改权重。 |
| 版本 | `project_version.list` | 分页读取草稿和已发布版本。 |
| 版本 | `project_version.get` | 读取版本、所属项目和发布字段。 |
| 版本 | `project_version.create_draft` | 创建空草稿，或从同项目的已发布版本复制文档树。 |
| 版本 | `project_version.check_draft` | 只读执行正式发布所用的就绪校验。 |
| 分类 | `category.list` | 分页读取分类和所属版本摘要。 |
| 分类 | `category.create` | 在草稿版本中创建分类。 |
| 分类 | `category.update` | 修改或在草稿版本之间移动分类。 |
| 笔记 | `note.list` | 分页读取笔记、父级摘要和正文版本数。 |
| 笔记 | `note.get` | 读取笔记元数据和父级摘要。 |
| 笔记 | `note.create` | 创建笔记，作者固定为当前 MCP Key 所属管理员。 |
| 笔记 | `note.update` | 修改或在草稿分类之间移动笔记。 |
| 正文 | `note_content.list_versions` | 读取轻量正文版本列表，不返回 Markdown。 |
| 正文 | `note_content.get` | 读取一个正文版本的完整 Markdown。 |
| 正文 | `note_content.create_draft` | 创建正文历史项；首个正文自动成为主正文。 |
| 正文 | `note_content.update_draft` | 更新 Markdown、版本说明或启用状态。 |
| 正文 | `note_content.set_primary_draft` | 原子切换笔记的主正文版本。 |

所有 ID 参数都必须是正十进制字符串，例如：

```json
{
  "projectVersionId": "12"
}
```

列表 Tool 的默认分页为 `page=1`、`pageSize=20`，单页最多 50 条。成功结果同时提供 JSON 文本和 `structuredContent`，不会添加网页 API 的 `{code,message,data}` 外壳。

从已发布版本创建草稿的示例：

```json
{
  "projectId": "9",
  "sourceVersionId": "11",
  "version": "2.0",
  "description": "下一版本草稿"
}
```

`sourceVersionId` 必须属于 `projectId` 指定的同一项目，且来源必须已经发布、未删除。省略 `description` 或 `weight` 时沿用来源；不提供 `sourceVersionId` 时创建空草稿，默认说明为 `null`、权重为 `0`。

## 工作流 Prompt

| Prompt | 用途 |
| --- | --- |
| `workflow.create_project_draft` | 检查精确同名项目，然后创建项目、版本草稿，并可按提纲建立分类、笔记和正文。 |
| `workflow.organize_notes` | 读取现有草稿树，按要求创建或更新分类、笔记、正文和主正文。 |
| `workflow.pre_publish_check` | 调用只读预检，解释阻塞问题并给出按实体 ID 定位的修复建议。 |

Prompt 返回给 MCP 客户端模型的是标准化执行指令，不会由服务端自行递归调用 Tool，也不增加工作流级二次确认。实际 Tool 是否逐次审批由 MCP 客户端决定。

## 草稿与发布边界

项目版本一旦发布，版本本身及其分类、笔记、正文即被冻结。所有文档树写 Tool 都调用与网页后台相同的 Service、可串行化事务和版本锁；遇到发布版本会返回 `VERSION_FROZEN`，不会绕过业务规则或部分写入。

`project.update_metadata` 有一个明确例外：已有发布版本的项目仍可调整权重，这可能立即改变公开排序；名称和头像必须在网页后台修改。含名称或头像的混合更新会整体失败，不会只应用其中的权重。

`project_version.check_draft` 检查父项目状态、启用分类、启用笔记、唯一未删除主正文、主正文启用状态和非空正文。结果仅代表本次读取时刻；网页后台正式发布时会在事务中重新执行同一校验。

MCP 不注册发布、撤回、删除、恢复、批量操作或版本可见性 Tool。普通用户 MCP、备份/恢复、系统设置、积分、卡密和链上交易操作也不在此入口提供。上述高风险操作继续由网页后台确认；后续如开放 MCP 发布，应采用独立的两段式确认协议。

Tool、Prompt 与 Resource 注册分别位于 `src/server/mcp/tools/`、`src/server/mcp/prompts.ts` 和 `src/server/mcp/resources.ts`，均复用 `/mcp` 的 MCP Key 鉴权边界。
