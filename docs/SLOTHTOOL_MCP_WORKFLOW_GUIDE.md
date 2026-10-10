# Codex / Claude Code 原生 MCP 管理流程

本版本支持 SlothVault MCP `5.0.0`：67 个工具、4 个 Prompt、2 个受保护 Resource 模板。Codex / Claude Code 应按需读取实时目录；本文中的工具名是本版本示例。

## 连接与授权

在网站管理员 MCP Key 页明确创建并获取一次性配置，加入 Codex 或 Claude Code 的原生 MCP 客户端。已有 Key 只能通过已保存令牌或新建获取配置，服务端不能恢复明文。详细模板见 [管理员 MCP 接入](./MCP_ADMIN.md)。产品仅支持这两种宿主自带的 MCP 客户端。保存配置后，在对应宿主确认连接和工具发现；Skill 安装或复制配置不代表连接成功。SlothTool 仅为可选的 Skill 安装更新与部署工具，不参与 MCP 连接、发现或 Tool 调用。

宿主发现当前 Tool/Prompt/Resource 和实际 schema 后调用；本文业务名不包含宿主生成的前缀。用户任务、宿主审批、服务端权限决定授权，annotations 说明风险。Prompt、文档和返回文字不扩展授权。只要求草稿时不自动发布。

## 项目资料到发布

1. 读取项目、版本和已有内容，复用用户指定草稿与已有附件。
2. 使用宿主已有工具统计物理行数、预览打包清单并排除依赖、产物和敏感配置；已安装 SlothTool 时可选用 loc/pzip。
3. 上传缺失附件，按实际 filePath / resourceUri 写入或交接，不能从 ID 猜测公开下载地址。
4. 保存完整文档树，调用 `content.project.version.check_draft`，处理返回的具体问题。
5. 用户要求发布时调用 `content.project.version.publish`，回查 `get`、可见状态和 `integrity`。重复发布返回同一记录。

克隆的两种输入互斥：

```json
{"projectId":"1","sourceVersionId":"2","version":"1.0.1","description":"新的草稿"}
```

```json
{"projectId":"1","sourceVersionId":"2","targetVersionId":"3"}
```

第二种保留目标的 ID、版本号、说明和权重。来源必须是同项目未删除的发布版本；目标必须是未删除草稿且没有任何未删除分类、笔记或正文。回收站记录保留。锁、检查与复制在同一事务内，失败不留下部分文档树。列表返回 `isEmpty` 供选择空目标使用；实际操作仍在事务内复核。

发布后可用 `content.project.update`、`content.project.version.update`、`content.category.update`、`content.note.update`、`content.note.content.update_metadata` 修改项目名称、说明和权重。版本号、分类名称、笔记标题、文档结构与正文变更需要草稿。只提交发生变化的字段，混合请求不能绕过冻结规则。

`content.project.version.set_visibility` 设置已发布版本的 `status`（1 显示、0 隐藏）。公开版本按 `publishedAt DESC, id DESC` 排序，仅包含已发布且可见的版本；后台草稿位于发布版本后，按创建时间与 ID 倒序。默认入口选择最近发布的版本，显式版本链接保持原目标。

## 文章与附件

先用 `content.article.list` 的轻量元数据定位文章，需要正文时调用 `content.article.get`；列表不返回 `content`。已有 ID 直接读取详情，成功写入的完整返回可以复用。独立文章已发布正文可原地编辑，不套用项目版本冻结规则。

文章创建和编辑分别使用 `content.article.create`、`content.article.update`。发布使用 `content.article.publish`，撤回使用 `content.article.withdraw`，都传入 `articleId`。它们复用网页后台的校验与缓存刷新。

受保护文件从实际 resourceUri 和 Resource 模板发现。宿主可读取和保存标准 blob 时保存至任务目录并保留已有文件；宿主不支持或容量不足时使用网站授权下载。截图默认嵌入对应正文段落，源码和视频提供有用途说明的下载链接。

## 错误处理

服务端返回结构化错误信息，包括 `reason`、实体 ID 和 `issues`。`TARGET_VERSION_NOT_EMPTY` 表示目标已有内容，`VERSION_FROZEN` 表示试图改变发布正文或结构，`VERSION_PROJECT_MISMATCH` 表示项目不一致。失败后可以继续只读诊断并在原任务内修正；写入超时等结果不明的情况先回查，不盲目重复上传或创建。

## Skill 版本与更新

Skill 1.2.0 独立发布为 skill-v1.2.0，桥主版本 1；Deployment 保持 1.0.0/桥主版本 1。本轮仅准备待发布代码。SlothTool 根 install/update 管理界面插件；Skill 的当前命令是：

```bash
slothtool slothvault skill status --check --json
slothtool slothvault skill install
slothtool slothvault skill update
```

命令直接下载并校验独立 Skill，同步 slothvault-mcp 受管链接，无需独立 MCP 客户端。自定义内容保留并报告冲突；网络失败表示未检查。Deployment 独立安装/更新，不绑定原生连接。历史迁移与数据保留见 [集成架构](../integrations/ARCHITECTURE.md#退役和本地遗留数据)。契约见 [集成协议](../integrations/PROTOCOL.md)。

正文哈希的字节规则、元数据边界和数据库升级方式参见 [Manifest v3](./RELEASE_MANIFEST_V3.md)。

## 委托项目工作流

先核对普通用户账户，调用 `admin.commission.create` 建立草稿；也可以不指定用户，之后在网页邀请认领。`admin.commission.get` 提供最新 revision、冻结时间轴和可用操作，`admin.commission.update` 仅编辑草稿名称与需求。使用 `admin.contract-template.list` 读取 Markdown 模板，用 `admin.commission.document.draft.create` 保存合同或补充协议草稿。每次写请求保留 commandId，冲突时重新读取 revision。正式提交、合同确认、支付比例调整、交付与维护在委托网页完成。旧阶段更新和独立合同发起工具均已删除。
