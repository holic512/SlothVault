# 管理员 MCP 接入

SlothVault 在现有 Web 应用中提供单一的管理员 MCP Streamable HTTP 入口：

```text
POST https://<你的 SlothVault 域名>/mcp
```

该入口仅接受通过管理员 MCP Key 认证的请求。它不接受、也不会回退到浏览器的 `sv_session` Cookie。

产品仅支持 **Codex、Claude Code 自带的 MCP 客户端**，只维护这两种宿主的配置与使用指导，不提供第三方客户端适配、自建客户端、代理或桥接接入支持。服务端保持标准 MCP 协议，以管理员 MCP Key 鉴权，不根据 `clientInfo.name`、客户端版本或 User-Agent 判断准入。SlothTool 是可选的 Skill 安装更新与部署工具，不参与连接、发现或 Tool 调用。

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

`expiresAt` 可省略或设为 `null`，表示 Key 不设置到期时间。创建响应会在 `data.key` 中返回完整 Key；这是唯一一次返回明文 Key。管理响应均为 private, no-store；创建 mutation 仅缓存安全元数据，本次 Key 不进入持久化。后续查询只返回 Key 名称、脱敏提示、状态、创建时间、到期时间和最后使用时间。

## Codex / Claude Code 原生 MCP 配置

在管理员 MCP Key 页点击“获取接入配置”，填写名称和有效期并明确“创建 Key 并生成配置”。创建成功后弹窗一次性展示下面两种配置，关闭或“我已保存配置”会清除本次明文。已有 Key 的“接入说明”只显示占位模板，不恢复明文、不静默轮换 Key。复制成功只代表配置已复制；保存配置后，须在对应宿主确认连接状态和工具发现。

地址优先使用严格验证的 NEXT_PUBLIC_SITE_ORIGIN，缺失时为当前页面 origin；支持 HTTPS、localhost、端口和显式合法路径前缀，已有 /mcp 不重复追加。不读取 Host/Forwarded Header，不从 locale 或管理路径推导。无效配置会在创建前阻止提交。当前应用部署在根路径；使用前缀时须由反向代理保证该路径可达。

Codex（加入用户 config.toml）：

```toml
[mcp_servers.slothvault]
url = "https://your-vault.example/mcp"
http_headers = { Authorization = "Bearer SLOTHVAULT_MCP_KEY_EXAMPLE_ONLY" }
default_tools_approval_mode = "auto"
tool_timeout_sec = 120
```

Claude Code（Bash / zsh，用户级）：

```bash
claude mcp add --transport http --scope user slothvault 'https://your-vault.example/mcp' --header 'Authorization: Bearer SLOTHVAULT_MCP_KEY_EXAMPLE_ONLY'
```

以上仅使用明显占位令牌。模板生成器分别使用合法 TOML 字符串和 POSIX Shell 单引号转义；没有 Windows 命令模板。Codex auto 表示宿主审批策略，服务器仍验证 Key 权限。两个模板直连标准 HTTP，无 stdio 转发器或专用 Python 包。

配置资料：[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp)、[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)、[Claude Code MCP](https://code.claude.com/docs/en/mcp)。配置字段与命令的核验范围见 [验证记录](../integrations/skill/tests/VALIDATION.md#原生宿主接入补充验证)。Claude `--header` 为可变参数，放在名称与 URL 之后。

将完整 Key 配置为 MCP 客户端请求 `/mcp` 时的 Bearer 凭据：

```http
Authorization: Bearer svmcp_<public-id>.<secret>
```

服务端只存储 `<secret>` 的 Argon2id 哈希。每次 MCP 请求都会重新检查：

1. Key 格式、状态和过期时间；
2. Key 所属账号仍是启用状态；
3. Key 所属账号仍具备 `ADMIN` 角色。

任一检查失败都会返回 HTTP `401` 和 MCP JSON-RPC 未认证错误。禁用或删除 Key 在下一次外部 MCP 请求时立即生效。

## MCP 5.0 Tool

MCP server identity 为 `slothvault-admin-mcp@5.0.0`。当前注册表共 71 个 Tool、4 个 Prompt、2 个 Resource 模板；按实时 schema 发现并使用点号分层的业务名称。

完整 Tool/Resource 清单、领域、风险、幂等性、URI、文件名和大小上限由注册表生成：[MCP Registry 清单](./MCP_REGISTRY.md)。修改 `src/server/mcp/tools/` 或 `src/server/mcp/resource-catalog.json` 后运行 `npm run mcp:docs`；CI 使用 `npm run mcp:docs:check` 阻止文档过期。

原生宿主的调用范例、人工交接和 Skill 更新见 [原生 MCP 工作流指南](./SLOTHTOOL_MCP_WORKFLOW_GUIDE.md)。

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

允许的 `businessType` 为 `ProjectAvatar`、`ArticleCover`、`ArticleImage`、`ArticleAttachment`、`NoteImage`、`NoteAttachment`、`HomeworkFile`、`Markdown` 和 `Other`。系统、用户头像、合同和委托附件不能通过该工具上传。

| 内容归属 | 内嵌图片 | 下载附件（ZIP、PDF、Office 等） |
| --- | --- | --- |
| 独立文章 | `ArticleImage` | `ArticleAttachment` |
| 项目笔记 | `NoteImage` | `NoteAttachment` |

图片分类仅支持 JPG/JPEG、PNG、GIF、WebP；下载附件沿用通用白名单：这些图片格式及 ZIP、PDF、TXT、MD、JSON、DOCX、XLSX、PPTX。项目头像限制 2 MiB，其他普通文件 10 MiB。图片还会执行真实格式和解码校验。

必须先完成全部材料上传，再根据实际返回的 `filePath` 撰写并保存正文，例如返回 `uploads/note-attachment/<id>.zip` 后使用 `[源码](/uploads/note-attachment/<id>.zip)`。`resourceUri` 供 MCP 读取，不作为网页图片或下载地址。失败时停止正文保存；结果不明先回查，禁止重复上传、猜测文件地址或保存占位链接。

新建或修改正文/封面时，服务端校验托管文件的有效记录和物理文件，缺失时返回 `MANAGED_FILE_UNAVAILABLE` 及 `filePaths`，本次正文和引用关系不写入。外部链接不做网络探测，历史恢复和引用重建不应用这项新写入校验。Tool 只返回元数据与 Resource URI，不嵌入文件 Base64。

数据库 revision 12 将旧文章/笔记图片分类迁移为 `ArticleImage`/`NoteImage`，保留文件 ID、路径及正文。备份 2.12 保留明确分类，导入旧版本备份时执行相同分类转换。旧客户端应重新发现上传 Schema，并采用四类用途。

受保护 Resource URI 为：

```text
slothvault://managed-file/{id}
slothvault://contract-attachment/{contractId}
```

每次 `resources/read` 都会重新验证当前 MCP Key。托管文件 Resource 只读取状态有效且非合同附件的文件；合同附件 Resource 通过合同授权 Service 返回原始文件名、`application/pdf` 和 blob，不暴露合同附件公共 URL。已删除、失效、缺失或业务类型不匹配的文件会返回受控错误。

托管 Resource 上限 10 MiB，合同 PDF 上限 25 MiB，文件名上限 255。宿主可保存二进制 blob 时使用宿主能力；无法保存或处理容量不足时通过网站现有授权下载。服务端不提供带 Key 的公共下载 URL。

Resource 内容遵循标准 MCP `ReadResourceResult`：二进制数据位于 `blob`，原始文件名位于 `_meta["slothvault/file-name"]`，不使用非标准的顶层 `name` 字段。

## 工作流 Prompt

| Prompt | 用途 |
| --- | --- |
| `workflow.create_project_draft` | 检查精确同名项目，然后创建项目、版本草稿，并可按提纲建立分类、笔记和正文。 |
| `workflow.organize_notes` | 读取现有草稿树，按要求创建或更新分类、笔记、正文和主正文。 |
| `workflow.pre_publish_check` | 调用只读预检，解释阻塞问题并给出按实体 ID 定位的修复建议。 |
| `workflow.publish_version` | 校验用户指定的草稿并按任务要求发布、回读状态。 |

Prompt 返回给 MCP 客户端模型的是标准化执行指令，不会由服务端自行递归调用 Tool，也不增加工作流级二次确认。实际 Tool 是否逐次审批由 MCP 客户端决定。

## 草稿与发布边界

项目版本一旦发布，版本号、分类名称、笔记标题、正文、主正文选择、文档树成员及其启停状态即被冻结；项目名称、说明和权重仍可编辑。所有文档树写 Tool 都调用与网页后台相同的 Service、可串行化事务和版本锁；遇到发布版本会返回 `VERSION_FROZEN`，不会绕过业务规则或部分写入。

发布后的元数据编辑只发送需要变化的字段，混合名称、标题、版本号、正文或结构修改仍整体受冻结规则约束。项目版本聚合凭证采用 Manifest v3，`admin.evidence.list/get` 只读当前 v3 凭证与尝试，旧内容凭证不参与统计或签名。

`content.project.version.check_draft` 检查父项目状态、启用分类、启用笔记、唯一未删除主正文、主正文启用状态和非空正文。结果仅代表本次读取时刻；正式发布时会在事务中重新执行同一校验。

MCP 支持项目版本发布、可见性调整及文章发布/撤回，复用网页业务规则。用户任务、宿主审批和服务端权限共同约束调用；没有额外 CLI 确认机制。删除/恢复、批量操作、密码重置、积分调整、卡密发行、会员授予/撤销、正式合同发起或代签、链上提交、备份恢复、设置写入和系统更新执行仍通过网站。

Tool、Prompt 与 Resource 注册分别位于 `src/server/mcp/tools/`、`src/server/mcp/prompts.ts` 和 `src/server/mcp/resources.ts`，均复用 `/mcp` 的 MCP Key 鉴权边界。


## 委托项目与合同草稿（自 MCP 4.0.0 起）

委托工作区以冻结时间轴连接需求、合同、支付比例、交付与维护，与公开文档项目独立。

1. 使用 `admin.user.list` 核对启用的普通用户，再调用 `admin.commission.create` 建立草稿；未指定用户时保留为待邀请状态。
2. 用 `admin.commission.get` 读取最新 `revision` 和可用操作，`admin.commission.update` 仅能编辑草稿阶段的名称和需求。
3. 用 `admin.contract-template.list` 读取 Markdown 发布版本和字段定义，再调用 `admin.commission.document.draft.create` 保存合同或补充协议草稿。
4. 在委托网页完成正式提交、接单、合同在线／线下确认、支付比例调整、交付与维护。正式交付立即开启维护期。
5. 链上存证由管理员在网页连接钱包，确认网络与手续费后签名。MCP 不代签，也不直接广播钱包交易。

旧的通用阶段更新工具已删除。正式记录只能追加补充；写入须带 `commandId` 与最新 `revision`，冲突时先重新读取。历史合同查询及受保护附件 Resource 继续可用。

## MCP 5.0：文章列表与正文分离

`content.article.list` 只返回原有文章元数据，不再返回 `content`。对应数据库查询也不读取正文；需要正文的调用方应先定位文章，再调用 `content.article.get`。后台管理列表 `GET /api/admin/mm/article` 同步采用该契约；编辑器已经通过详情接口读取正文。创建、更新、发布、撤回和详情返回继续包含完整正文。

这是业务输出契约的不兼容变更，依赖旧列表正文的客户端需要迁移并刷新工具发现。服务器身份版本为 5.0.0；MCP 日期协议、鉴权、维护锁、71 个 Tool、4 个 Prompt 和 2 个 Resource 模板保持不变。发布后正文冻结仅适用于项目版本；独立文章仍可原地编辑，可能立即影响公开内容。公开文章列表的默认摘要生成逻辑保持不变。

## 单篇笔记的标签工具

优先用单标签工具完成局部操作，避免客户端先读取列表再整组写回造成并发覆盖。

| Tool | 输入 | 输出 / 语义 |
| --- | --- | --- |
| `content.note.tag.list` | `noteId` | 返回 `{ noteId, tags }`；已发布笔记也可读取。 |
| `content.note.tag.add` | `noteId`, `tag` | 添加一个标签；已有同名标签时不重复添加。 |
| `content.note.tag.rename` | `noteId`, `tag`, `newTag` | 保留原位置改名；原标签不存在返回 404，新名称被其他标签占用返回 409。 |
| `content.note.tag.remove` | `noteId`, `tag` | 移除一个标签；不存在时返回当前列表。 |

全部写操作在所属草稿版本的事务锁内执行，保留其他标签，返回完整结果列表。重复添加、移除和同名改名的结果不改变标签；已发布版本始终拒绝写入。名称去首尾空白、不能为空、大小写敏感，每篇最多 10 个标签、每个最多 30 个字符。标签不参与正文或项目发布哈希。

现有 `content.note.create/update` 的 `tags` 数组接口继续用于初始化或明确的整组替换。新增工具后刷新 MCP 工具发现；Skill 使用相同名称和参数契约。
