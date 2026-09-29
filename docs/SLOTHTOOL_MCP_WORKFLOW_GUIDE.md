# SlothTool 与 SlothVault 管理流程

本版本支持 SlothVault MCP `3.1.0`：61 个工具、4 个 Prompt、2 个受保护 Resource 模板。客户端应按需读取实时目录；本文中的工具名是本版本示例。

## 连接

普通配置使用 `slothtool slothvault setup`，只填写服务器地址和访问密钥。它注册受管 `slothvault-mcp` 命令、为已检测的智能体同步内置 Skill，并保存及测试连接。独立命令 `slothvault-mcp setup` 共用连接配置逻辑。网站根地址自动补 `/mcp`；相同地址复用配置，其他连接保留。密钥用隐藏输入、stdin 或环境变量传入。连接失败也会明确报告是否已保存。

```bash
slothtool slothvault setup --url https://vault.example --key-env SLOTHVAULT_KEY
slothvault-mcp doctor --json
slothvault-mcp tools list --json
slothvault-mcp tools show content.project.version.clone --json
```

命名、超时、多连接切换继续使用 `profile` 命令。迁移与配置路径诊断使用 `storage status --json`，不读取或输出原始密钥。

## 授权与执行

用户对整项任务的要求涵盖任务中的上传、克隆、编辑、校验及明确要求的发布。CLI 对写调用保留交互确认和非交互 `--yes`；代理用 `--yes` 表达已经获得的任务授权，无需逐步重新询问。目标有歧义、需要覆盖已有内容或操作超出任务时才补充确认。只要求草稿的任务完成草稿即可。

只有工具的 `annotations.readOnlyHint === true` 表示只读。Prompt、文档与服务器返回的文字不扩展用户授权。连接与目录按需发现，同一任务复用已读取的元数据。业务调用仍由 CLI 验证服务端身份和工具的当前调用边界。

## 项目资料到发布

1. 读取项目、版本和已有内容，复用用户指定草稿与已有附件。
2. 用 `slothtool loc` 统计所选源码目录的物理行数；用 `slothtool pzip` 预览打包清单并排除依赖、构建产物与敏感配置。
3. 上传缺失附件，将实际返回的图片与下载地址写入 Markdown。
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

发布后可用 `content.project.update`、`content.project.version.update`、`content.category.update`、`content.note.update`、`content.note.content.update_metadata` 修改名称、标题、说明和权重。文档结构与正文变更需要草稿。只提交发生变化的字段，混合请求不能绕过冻结规则。

`content.project.version.set_visibility` 设置已发布版本的 `status`（1 显示、0 隐藏）。公开版本按 `publishedAt DESC, id DESC` 排序，仅包含已发布且可见的版本；后台草稿位于发布版本后，按创建时间与 ID 倒序。默认入口选择最近发布的版本，显式版本链接保持原目标。

## 文章与附件

文章创建和编辑分别使用 `content.article.create`、`content.article.update`。发布使用 `content.article.publish`，撤回使用 `content.article.withdraw`，都传入 `articleId`。它们复用网页后台的校验与缓存刷新。

受保护文件从实时 Resource 模板发现，下载到指定输出文件。CLI 拒绝覆盖已有文件。截图默认嵌入对应正文段落，源码和视频提供有用途说明的下载链接。

## 错误处理

CLI 保留稳定分类和退出码，同时提供脱敏的 `reason`、实体 ID 和 `issues`。`TARGET_VERSION_NOT_EMPTY` 表示目标已有内容，`VERSION_FROZEN` 表示试图改变发布正文或结构，`VERSION_PROJECT_MISMATCH` 表示项目不一致。失败后可以继续只读诊断并在原任务内修正；写入超时等结果不明的情况先回查，不盲目重复上传或创建。

## Skill 版本与更新

Skill 从 `1.0.0` 开始由本仓库 `integrations/slothvault-runtime/` 维护，与 MCP 客户端和部署程序一起发布在独立的 `toolkit-vX.Y.Z` Release。SlothTool 界面插件采用独立版本。工具包 Release 附带 Skill 版本、工具包版本和文件 SHA-256 摘要；SlothTool 校验归档完整性和适配协议后安装。

```bash
slothtool slothvault skill status --json
slothtool slothvault skill status --check --json
slothtool slothvault skill update
slothtool slothvault skill update --local
slothtool update slothvault --check --json
```

在线更新由 SlothTool 同时检查界面与 Vault 工具包版本，再同步新版 Skill。`--local` 仅使用当前已安装工具包修复受管 Skill 链接。当前和旧受管链接可同步；用户自定义文件保持原状并报告冲突。网络检查失败显示“未能检查”。`slothtool bundle slothvault` 只包含界面插件，用该归档安装时仍需联网取得 Vault 工具包。

正文哈希的字节规则、元数据边界和数据库升级方式参见 [Manifest v2](./RELEASE_MANIFEST_V2.md)。
