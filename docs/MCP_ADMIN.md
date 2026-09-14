# 管理员 MCP 接入（第一阶段）

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

## 第一阶段已注册 Tool

`admin_project_list`：分页读取管理员项目列表。它是只读 Tool，直接调用现有 `listAdminProjects` Service；不会通过网页 Route Handler 转发，也不会创建、发布、修改或删除项目。

Tool 与 Resource 注册分别位于 `src/server/mcp/tools/` 和 `src/server/mcp/resources.ts`。后续添加项目、版本、分类和笔记管理能力时，应在相应注册表中调用已有 Service，并继续走 `/mcp` 的 MCP Key 鉴权边界。

## 第一阶段边界

当前阶段不提供 MCP 写入工具、普通用户 MCP、资源正文读取、发布操作、备份/恢复、系统设置、积分、卡密或链上交易操作。后续写工具应在 Service 层沿用现有草稿、事务与发布约束，不得绕过业务规则。
