# SlothVault MCP Client 全场景操作与 Skill 设计指南

本文面向通过独立 `slothvault-mcp` 命令操作 SlothVault 管理员 MCP 的使用者，以及准备把这些流程封装为自动化 Skill 的开发者。该命令由 SlothTool 的 `slothvault` 多功能插件显式注册；目标不是重复列出全部 JSON Schema，而是给出一套可以执行、验证、停机和人工交接的标准流程。

本文基于当前 SlothVault MCP 3.0 与 SlothTool `slothvault` 插件实现编写。兼容性基线为：

- MCP server identity：`slothvault-admin-mcp@3.0.0`；
- 当前实时目录：55 个 Tool、3 个 Prompt、2 个 Resource Template。

运行时应始终以 `doctor`、`tools list/show`、`prompts list` 和 `resources list` 的实时发现结果为准。版本号和能力数量只能作为兼容性基线，不能代替动态发现。

相关文档：

- [管理员 MCP 接入](./MCP_ADMIN.md)
- [MCP Registry 清单](./MCP_REGISTRY.md)

## 1. 先理解能力边界

SlothTool 是 MCP Client，SlothVault 是 MCP Server。一次典型调用链为：

```text
Skill / 操作者
  -> slothvault-mcp CLI
    -> Streamable HTTP POST /mcp
      -> MCP Key 鉴权
        -> SlothVault Tool / Prompt / Resource
          -> 既有 Service、事务与业务规则
```

MCP Key 代表其所属管理员账号的管理权限。网页 Session Cookie 不能替代 MCP Key，MCP Key 也不应交给普通用户。

当前能力按业务域分组如下：

| 领域 | 可通过 MCP 读取 | 可通过 MCP 写入 | 明确不通过 MCP 开放 |
| --- | --- | --- | --- |
| 项目 | 列表、详情 | 创建项目外壳、更新草稿期元数据、调整权重 | 删除、恢复、批量、已有发布版本后的名称/头像修改 |
| 项目版本 | 列表、详情、发布前检查、完整性、发布清单 | 创建空草稿、从已发布版本克隆草稿 | 编辑版本元数据、发布、撤回、删除、恢复、可见性调整 |
| 分类 | 列表 | 草稿中创建、更新、移动 | 删除、恢复、批量 |
| 笔记 | 列表、详情 | 草稿中创建、更新、移动 | 删除、恢复、批量 |
| 笔记正文 | 版本列表、正文详情 | 创建正文草稿、更新正文、设置主正文 | 删除、恢复、发布版本修改 |
| 托管文件 | 列表、元数据、Resource 下载 | 单文件上传 | 删除、恢复、合同附件上传、系统/用户头像上传 |
| 文章 | 列表、详情 | 创建草稿、更新内容与会员要求 | 发布、撤回、删除、恢复 |
| 项目主页与菜单 | 列表、详情 | 创建、更新 | 删除、恢复；写入可能立即影响公开页面 |
| 系统首页 | 详情 | 创建、更新 | 删除、恢复；写入可能立即影响公开首页 |
| 用户与会员 | 用户、会员等级、会员历史、积分流水 | 无 | 用户创建/禁用、积分调整、会员等级配置、会员授予/撤销、密码重置 |
| 合同 | 列表、详情、附件 Resource 下载 | 无 | 创建、签发、签署、拒绝、取消、附件写入 |
| 存证 | 数据库中的存证列表与详情 | 无 | 链上提交、RPC 核验、补提 |
| 系统 | 仪表盘、脱敏设置、更新状态 | 无 | 设置写入、备份恢复、系统更新执行 |

因此，完整业务流程经常是“先用 MCP 检查和准备，再到网页后台执行高风险动作，最后回到 MCP 只读验证”，而不是强行让 MCP 完成所有步骤。

## 2. SlothTool Client 初始化

### 2.1 服务端管理员创建 MCP Key

管理员在 SlothVault 网页后台 `/admin/mm/mcp` 创建专用 Key。建议：

- 每个 Skill、工作区或自动化主体使用独立 Key；
- 名称包含用途和责任人；
- 设置合理到期时间；
- 测试、生产使用不同 Key；
- 任务结束或人员变更时立即禁用或删除。

完整 Key 只在创建响应中出现一次。不要把它写入脚本、仓库、命令行参数、报告或聊天记录。

### 2.2 安装插件并建立 Profile

```bash
slothtool install slothvault
slothtool slothvault mcp register
```

推荐通过标准输入录入 Key：

```bash
printf '%s\n' "$SLOTHVAULT_MCP_KEY" | \
  slothvault-mcp profile add production \
  --url https://vault.example.com/mcp \
  --key-stdin \
  --timeout 30000 \
  --default \
  --json
```

也可以使用 `--key-env SLOTHVAULT_MCP_KEY`。禁止使用不存在的 `--key` 参数，因为完整 Key 会进入进程参数和 shell 历史。

Profile 保存在：

```text
~/.pipker/slothtool/plugin-configs/slothvault.json
```

该文件包含明文 Key。SlothTool 会用私有权限创建它，但备份和 `gstore` 私有同步仓库仍应按凭据数据保护。

### 2.3 建立兼容性基线

```bash
slothvault-mcp doctor --profile production --json
slothvault-mcp tools list --profile production --json
slothvault-mcp prompts list --profile production --json
slothvault-mcp resources list --profile production --json
```

当前兼容性检查应至少确认：

```text
server.name = slothvault-admin-mcp
server.version = 3.0.0
capabilities.tools = 55
capabilities.prompts = 3
capabilities.resourceTemplates = 2
```

如果身份不匹配、能力数量发生变化或必需 Tool 不存在，Skill 应停止，不应继续执行写操作。能力增加并不一定是不兼容；应继续用 `tools show` 检查实际 Schema 和 annotations。

### 2.4 每次调用前查看实时 Tool 契约

```bash
slothvault-mcp tools show content.project.create \
  --profile production \
  --json
```

Skill 不应把本文示例当成永久 Schema。调用前至少检查：

- Tool 是否仍存在；
- `inputSchema` 中的必填字段、类型和上限；
- `annotations.readOnlyHint`；
- Tool description 中的业务边界。

## 3. 统一调用规范

### 3.1 ID、分页与 JSON

所有 MCP 业务 ID 都是正十进制字符串：

```json
{
  "projectVersionId": "12"
}
```

不要传 JSON number `12`，不要传 `0`、负数、浮点数、科学计数法或带其他字符的字符串。

分页 Tool 的通用范围：

- `page`：1 到 10000，默认 1；
- `pageSize`：1 到 50，默认 20；
- 需要完整目录时使用 `pageSize=50` 并持续翻页，直到累计数量覆盖 `total`。

输入 Schema 多数为严格对象。未知字段会失败，Skill 不应把本地状态、注释或追踪字段混入 Tool 参数。

### 3.2 读写确认

只有实时 Tool 声明中的 `annotations.readOnlyHint === true` 才被 SlothTool 视为只读。其他 Tool 一律按写操作处理：

```bash
# 只读，不需要 --yes
slothvault-mcp tools call content.project.list \
  --args '{"page":1,"pageSize":50,"keyword":"项目 XXX"}' \
  --profile production \
  --json

# 写操作，在非交互或 --json 模式中必须显式 --yes
slothvault-mcp tools call content.project.create \
  --args '{"projectName":"项目 XXX","avatar":null,"weight":0}' \
  --profile production \
  --yes \
  --json
```

`--yes` 仅表示 Client 已获得本次写调用确认，不代表服务端会绕过校验，也不代表可以发布、删除或执行未注册能力。

### 3.3 复杂参数使用文件

长 Markdown、文章正文和 Base64 文件不适合直接放入命令行。使用临时 JSON 文件：

```bash
slothvault-mcp tools call content.note.content.create_draft \
  --args-file /tmp/slothvault-note-content.json \
  --profile production \
  --yes \
  --json
```

如果使用 `--args-file -` 从标准输入读取，写 Tool 仍必须显式传入 `--yes`。不要在参数文件中放 MCP Key、密码、Cookie 或 Token。

### 3.4 结果取值

`tools call --json` 成功结果的业务对象位于：

```text
result.structuredContent
```

例如创建项目成功后，应从 `result.structuredContent.id` 保存 `PROJECT_ID`。不要从人类可读文本中用正则猜测 ID。

建议 Skill 维护一份仅存在于当前任务内存或私有临时文件中的实体账本：

| 变量 | 来源 |
| --- | --- |
| `PROJECT_ID` | `content.project.create` |
| `PROJECT_VERSION_ID` | `content.project.version.create_draft` 或 `clone` |
| `CATEGORY_ID` | `content.category.create` |
| `NOTE_ID` | `content.note.create` |
| `NOTE_CONTENT_ID` | `content.note.content.create_draft` |
| `FILE_ID`、`RESOURCE_URI` | `content.file.upload/get` |
| `ARTICLE_ID` | `content.article.create` |
| `USER_ID` | `admin.user.list/get` |
| `MEMBERSHIP_LEVEL_ID` | `admin.membership.level.list` |

### 3.5 退出码和恢复动作

| 退出码 | 含义 | Skill 应采取的动作 |
| ---: | --- | --- |
| 0 | 成功 | 读取结构化结果并做只读验证 |
| 1 | Client 内部错误 | 停止，保留脱敏诊断信息 |
| 2 | 用法、配置或缺少确认 | 修正本地输入；通常没有发出业务写调用 |
| 3 | 认证失败 | 停止；检查 Profile、Key 状态、到期时间和管理员账号 |
| 4 | 网络、超时、服务不可用、身份或协议错误 | 不自动重试写操作；先读取服务状态和目标实体判断是否已落库 |
| 5 | Tool `isError` 业务失败 | 停止当前链路；根据业务错误修正状态或参数后再重新规划 |

写 Tool 不会由 SlothTool 自动重试。Skill 也不应盲目重试非幂等创建操作。超时后必须先使用对应的 list/get Tool 做状态对账：

```text
写入前读取 -> 单次写入 -> 按返回 ID 读取验证
                   |
                   +-- 超时/断线 -> 按唯一业务键或已知 ID 读取对账 -> 决定停止或补做
```

### 3.6 Prompt 不是自动执行器

`prompts get` 只返回标准 MCP messages：

```bash
slothvault-mcp prompts get workflow.create_project_draft \
  --args '{"projectName":"项目 XXX","version":"1.0","outline":"快速开始；架构；部署"}' \
  --profile production \
  --json
```

SlothTool 不会自动执行 Prompt 中提到的 Tool。Skill 可以把 Prompt 作为最新服务端工作流策略读取并遵守，但仍要逐项发现、确认、调用和验证 Tool。

## 4. 标准执行状态机

建议所有 Skill 使用同一状态机：

```text
DISCOVER
  -> PREFLIGHT_READ
    -> PLAN_AND_CONFIRM
      -> WRITE_ONCE
        -> VERIFY_READ
          -> NEXT_STEP / HUMAN_HANDOFF / STOP_WITH_LEDGER
```

各阶段职责：

1. `DISCOVER`：运行 `doctor`，确认 server identity 和所需能力。
2. `PREFLIGHT_READ`：读取当前状态、精确匹配现有实体、确认没有冲突。
3. `PLAN_AND_CONFIRM`：列出将执行的写 Tool、参数摘要和可能影响；获取授权。
4. `WRITE_ONCE`：每个非幂等 Tool 最多调用一次。
5. `VERIFY_READ`：使用 get/list Tool 验证 ID、父子关系、状态、余额或历史数量。
6. `HUMAN_HANDOFF`：遇到发布、删除、会员授予等 MCP 边界时生成明确的网页操作清单。
7. `STOP_WITH_LEDGER`：任一步失败后停止，报告已创建实体 ID；不要继续制造平行结构。

## 5. 场景一：从零创建“项目 XXX”完整草稿

本例创建如下结构：

```text
项目 XXX
├── 项目主页（可选，可能影响公开页面）
├── 版本 1.0（草稿）
│   ├── 分类：快速开始
│   │   ├── 笔记：安装
│   │   │   └── 主正文：安装说明 Markdown
│   │   └── 笔记：第一个项目
│   │       └── 主正文：示例 Markdown
│   └── 分类：参考资料
│       └── 笔记：配置项
│           └── 主正文：配置说明 Markdown
└── 项目菜单（可选，可能影响公开导航）
```

### 5.1 读取服务端工作流建议

```bash
slothvault-mcp prompts get workflow.create_project_draft \
  --args '{"projectName":"项目 XXX","version":"1.0","description":"首个草稿","outline":"快速开始：安装、第一个项目；参考资料：配置项"}' \
  --profile production \
  --json
```

这一步只获取指令，不产生写入。

### 5.2 精确检查同名项目

```bash
slothvault-mcp tools call content.project.list \
  --args '{"page":1,"pageSize":50,"keyword":"项目 XXX"}' \
  --profile production \
  --json
```

如果 `total > 50`，继续翻页。对返回项的 `projectName.trim()` 做精确比较：

- 找到精确同名项目：停止，不复用、不修改、不创建重复项目；
- 只有相似名称：向操作者展示候选，确认后再创建；
- 没有精确同名：继续。

### 5.3 创建项目外壳

```bash
slothvault-mcp tools call content.project.create \
  --args '{"projectName":"项目 XXX","avatar":null,"weight":0}' \
  --profile production \
  --yes \
  --json
```

记录 `PROJECT_ID=result.structuredContent.id`，随后立即读取验证：

```bash
slothvault-mcp tools call content.project.get \
  --args '{"projectId":"<PROJECT_ID>"}' \
  --profile production \
  --json
```

项目外壳在没有已发布版本时不会出现在公开项目列表。

### 5.4 创建空版本草稿

```bash
slothvault-mcp tools call content.project.version.create_draft \
  --args '{"projectId":"<PROJECT_ID>","version":"1.0","description":"首个草稿","weight":0}' \
  --profile production \
  --yes \
  --json
```

记录 `PROJECT_VERSION_ID`。验证结果必须满足：

- `projectId` 等于 `PROJECT_ID`；
- `publishedAt` 为 `null`；
- `isDeleted` 为 `false`。

### 5.5 创建分类

```bash
slothvault-mcp tools call content.category.create \
  --args '{"projectVersionId":"<PROJECT_VERSION_ID>","categoryName":"快速开始","weight":10,"status":1}' \
  --profile production \
  --yes \
  --json

slothvault-mcp tools call content.category.create \
  --args '{"projectVersionId":"<PROJECT_VERSION_ID>","categoryName":"参考资料","weight":20,"status":1}' \
  --profile production \
  --yes \
  --json
```

分别记录分类 ID。任何一次失败都应停止后续创建并报告已创建 ID。

### 5.6 创建笔记

```bash
slothvault-mcp tools call content.note.create \
  --args '{"categoryId":"<QUICKSTART_CATEGORY_ID>","noteTitle":"安装","weight":10,"status":1}' \
  --profile production \
  --yes \
  --json

slothvault-mcp tools call content.note.create \
  --args '{"categoryId":"<QUICKSTART_CATEGORY_ID>","noteTitle":"第一个项目","weight":20,"status":1}' \
  --profile production \
  --yes \
  --json

slothvault-mcp tools call content.note.create \
  --args '{"categoryId":"<REFERENCE_CATEGORY_ID>","noteTitle":"配置项","weight":10,"status":1}' \
  --profile production \
  --yes \
  --json
```

新笔记的作者固定为当前 MCP Key 所属管理员。

### 5.7 创建 Markdown 正文

为每篇笔记创建正文参数文件，例如 `/tmp/slothvault-install-content.json`：

```json
{
  "noteId": "<INSTALL_NOTE_ID>",
  "content": "# 安装\n\n这里写安装步骤。",
  "versionNote": "初始草稿",
  "status": 1
}
```

调用：

```bash
slothvault-mcp tools call content.note.content.create_draft \
  --args-file /tmp/slothvault-install-content.json \
  --profile production \
  --yes \
  --json
```

每篇笔记的首个未删除正文会自动成为主正文。创建后用以下命令确认 `isPrimary=true`：

```bash
slothvault-mcp tools call content.note.content.list_versions \
  --args '{"noteId":"<INSTALL_NOTE_ID>"}' \
  --profile production \
  --json
```

如果后续创建第二个正文版本，只有在明确选择展示版本时才调用：

```bash
slothvault-mcp tools call content.note.content.set_primary \
  --args '{"noteContentId":"<NEW_NOTE_CONTENT_ID>"}' \
  --profile production \
  --yes \
  --json
```

### 5.8 完整读取草稿树

```bash
slothvault-mcp tools call content.category.list \
  --args '{"page":1,"pageSize":50,"projectVersionId":"<PROJECT_VERSION_ID>","keyword":"","orderBy":"weight","order":"asc"}' \
  --profile production \
  --json

slothvault-mcp tools call content.note.list \
  --args '{"page":1,"pageSize":50,"projectVersionId":"<PROJECT_VERSION_ID>","keyword":"","orderBy":"weight","order":"asc"}' \
  --profile production \
  --json
```

对每个笔记调用 `content.note.content.list_versions`，只在需要核对全文时调用 `content.note.content.get`，避免无谓加载大量 Markdown。

### 5.9 运行发布前检查

```bash
slothvault-mcp tools call content.project.version.check_draft \
  --args '{"projectVersionId":"<PROJECT_VERSION_ID>"}' \
  --profile production \
  --json
```

`ready=true` 只表示当前读取时刻通过校验。主要检查包括：

- 父项目状态有效；
- 至少存在启用分类；
- 分类中存在启用笔记；
- 每篇笔记只有一个未删除主正文；
- 主正文启用且非空。

也可以获取只读解释型 Prompt：

```bash
slothvault-mcp prompts get workflow.pre_publish_check \
  --args '{"projectVersionId":"<PROJECT_VERSION_ID>"}' \
  --profile production \
  --json
```

### 5.10 人工发布与发布后验证

MCP 不提供发布 Tool。操作者必须登录网页后台 `/admin/mm/projects`，进入项目的“版本管理”，核对草稿后执行发布。网页后台会在事务中重新运行发布校验。

发布后回到 MCP 验证：

```bash
slothvault-mcp tools call content.project.version.get \
  --args '{"projectVersionId":"<PROJECT_VERSION_ID>"}' \
  --profile production \
  --json

slothvault-mcp tools call content.project.version.integrity \
  --args '{"projectVersionId":"<PROJECT_VERSION_ID>"}' \
  --profile production \
  --json

slothvault-mcp tools call content.project.version.manifest \
  --args '{"projectVersionId":"<PROJECT_VERSION_ID>"}' \
  --profile production \
  --json
```

验收条件：`publishedAt` 非空、`releaseId`/`releaseHash` 非空、`integrity.valid=true`。

## 6. 场景二：从已发布版本创建下一版草稿

1. 调用 `content.project.version.list`，定位同一项目的来源版本。
2. 调用 `content.project.version.get`，确认来源：
   - `projectId` 与目标项目一致；
   - `publishedAt` 非空；
   - `isDeleted=false`。
3. 单次调用 `content.project.version.clone`：

```bash
slothvault-mcp tools call content.project.version.clone \
  --args '{"projectId":"<PROJECT_ID>","sourceVersionId":"<PUBLISHED_VERSION_ID>","version":"2.0","description":"下一版本草稿","weight":20}' \
  --profile production \
  --yes \
  --json
```

4. 记录新的 `PROJECT_VERSION_ID`，读取分类、笔记和正文版本确认树已复制。
5. 只修改新草稿，不修改来源发布版本。
6. 运行 `check_draft`，再交给网页后台发布。

来源未发布、已删除或属于其他项目时，Tool 会返回业务冲突。Skill 不应改为创建空版本并假装克隆成功。

## 7. 场景三：整理已有笔记草稿

先获取服务端 Prompt：

```bash
slothvault-mcp prompts get workflow.organize_notes \
  --args '{"projectVersionId":"<PROJECT_VERSION_ID>","requirements":"合并重复章节，补齐缺失主正文，但保留历史正文版本"}' \
  --profile production \
  --json
```

推荐顺序：

1. `content.project.version.get`：确认 `publishedAt=null`。
2. `content.category.list`：分页读取完整分类。
3. `content.note.list`：分页读取完整笔记。
4. `content.note.content.list_versions`：读取各笔记的正文版本摘要。
5. 必要时 `content.note.content.get`：读取待编辑正文。
6. 优先使用 update Tool；确实缺少结构时才 create。
7. 如果要切换展示正文，单独调用 `set_primary`。
8. 任一步返回 `VERSION_FROZEN` 或其他冲突，立即停止。
9. 最后重新读取树并运行 `check_draft`。

MCP 没有删除 Tool。所谓“合并重复章节”不能通过 MCP 删除旧实体；可在草稿中将不需要的分类、笔记或正文 `status` 更新为 `0`，或转交网页后台执行删除，并在报告中明确两者语义不同。

## 8. 场景四：上传、读取和下载托管文件

### 8.1 上传

允许的 `businessType`：

```text
ProjectAvatar
ArticleCover
ArticleAttachment
NoteAttachment
HomeworkFile
Markdown
Other
```

禁止通过 MCP 上传 `SystemLogo`、`SystemFavicon`、`UserAvatar` 和 `ContractAttachment`。

为避免把 Base64 放到命令行和历史中，可生成临时参数文件：

```bash
node -e '
const fs = require("node:fs");
const input = process.argv[1];
const output = process.argv[2];
const payload = {
  originalName: "guide.md",
  businessType: "Markdown",
  contentBase64: fs.readFileSync(input).toString("base64")
};
fs.writeFileSync(output, JSON.stringify(payload), { mode: 0o600, flag: "wx" });
' ./guide.md /tmp/slothvault-upload.json

slothvault-mcp tools call content.file.upload \
  --args-file /tmp/slothvault-upload.json \
  --profile production \
  --yes \
  --json
```

普通文件上限 10 MiB，项目头像上限 2 MiB。记录返回的 `id`、`filePath`、`fileSize`、`businessType` 和 `resourceUri`，然后删除临时参数文件。

上传 Tool 返回受保护 Resource URI，不返回旧的公共下载 URL。项目头像或文章封面的业务字段应只使用经过当前 SlothVault 页面规则验证的引用；Skill 不应仅凭 `resourceUri` 猜测公开 URL。

### 8.2 下载

```bash
slothvault-mcp tools call content.file.get \
  --args '{"fileId":"<FILE_ID>"}' \
  --profile production \
  --json

slothvault-mcp resources read 'slothvault://managed-file/<FILE_ID>' \
  --output ./guide.downloaded.md \
  --profile production \
  --json
```

SlothTool 会校验 URI、MIME、Base64、文件名和大小，以私有权限原子写入，并拒绝覆盖已有目标文件。Skill 应额外比较字节数或 SHA-256。

## 9. 场景五：创建带会员访问要求的文章草稿

### 9.1 读取可用会员等级

```bash
slothvault-mcp tools call admin.membership.level.list \
  --args '{"includeDisabled":false}' \
  --profile production \
  --json
```

根据精确的等级名称和 `rank` 选择 `MEMBERSHIP_LEVEL_ID`。不要按列表位置猜 ID。

### 9.2 创建文章草稿

准备参数文件：

```json
{
  "title": "项目 XXX 深度实践",
  "summary": "会员可读的进阶实践。",
  "cover": null,
  "content": "# 项目 XXX 深度实践\n\n这里写正文。",
  "requiredMembershipLevelId": "<MEMBERSHIP_LEVEL_ID>"
}
```

调用：

```bash
slothvault-mcp tools call content.article.create \
  --args-file /tmp/slothvault-article.json \
  --profile production \
  --yes \
  --json
```

记录 `ARTICLE_ID`，然后调用 `content.article.get` 验证标题、正文和 `requiredMembershipLevelId`。

MCP 只创建文章草稿。正式发布或撤回必须在网页后台 `/admin/mm/articles` 完成。

如果文章应公开访问，把 `requiredMembershipLevelId` 显式设为 `null`。更新时省略该字段表示“不改变”，传 `null` 表示“清除会员要求”。

## 10. 场景六：给其他用户配置会员

这是典型的“MCP 只读准备 + 网页后台人工写入 + MCP 只读验收”流程。

### 10.1 精确定位用户

```bash
slothvault-mcp tools call admin.user.list \
  --args '{"page":1,"pageSize":50,"keyword":"alice"}' \
  --profile production \
  --json
```

按 `username`、`email` 或明确的用户 ID 做精确确认。重名或模糊结果必须请求操作者选择。

读取用户详情：

```bash
slothvault-mcp tools call admin.user.get \
  --args '{"userId":"<USER_ID>"}' \
  --profile production \
  --json
```

### 10.2 读取当前会员、等级和积分证据

```bash
slothvault-mcp tools call admin.user.membership.get \
  --args '{"userId":"<USER_ID>"}' \
  --profile production \
  --json

slothvault-mcp tools call admin.membership.level.list \
  --args '{"includeDisabled":true}' \
  --profile production \
  --json

slothvault-mcp tools call admin.points.transaction.list \
  --args '{"userId":"<USER_ID>","page":1,"pageSize":50}' \
  --profile production \
  --json
```

在人工操作前生成摘要：

- 用户 ID、用户名和状态；
- 当前有效会员的等级、来源和到期时间；
- 历史授权是否已撤销或过期；
- 目标会员等级、rank、是否启用；
- 计划授予永久会员还是指定未来到期时间。

### 10.3 网页后台授予或替换会员

MCP 不注册会员授予/撤销 Tool。管理员必须：

1. 登录 SlothVault 网页后台；
2. 打开 `/admin/mm/users`；
3. 定位并再次核对目标用户；
4. 打开该用户的会员管理；
5. 选择会员等级；
6. 选择“永久”或填写未来到期时间；
7. 确认提交。

管理员设置新会员时，服务端会原子撤销该用户当前未撤销的授权，再创建新的 `ADMIN_GRANT`，同时保留历史审计记录。这是替换操作，不是简单叠加；Skill 的交接提示必须明确这一点。

撤销全部会员同样只能在该页面人工确认。

### 10.4 MCP 验收

再次调用：

```bash
slothvault-mcp tools call admin.user.membership.get \
  --args '{"userId":"<USER_ID>"}' \
  --profile production \
  --json
```

验收：

- `currentMembership.id` 等于目标等级 ID；
- `source` 为 `ADMIN_GRANT`；
- 永久会员的 `expiresAt=null`；
- 限时会员的 `expiresAt` 等于预期未来时间；
- 旧授权在历史中保留，必要时显示 `revokedAt` 和 `revokedByUserId`。

### 10.5 用户自行用积分购买

如果业务目标是“让用户自行购买”而不是管理员直接授予：

1. 管理员在 `/admin/mm/membership-levels` 配置启用的等级、价格和有效期；
2. 必要时在 `/admin/mm/users` 调整积分，或让用户兑换管理员发行的卡密；
3. 用户登录 `/account/membership` 自行确认购买；
4. 购买成功后积分、授权和 `MEMBERSHIP_PURCHASE` 流水在同一事务中写入；
5. 使用 MCP 的 `admin.user.membership.get` 和 `admin.points.transaction.list` 验收。

当前购买规则：

- 有效高级会员期间不能购买低等级；
- 高级会员过期后可以购买低等级；
- 同级有限期会员可续费，并从现有同级有限到期时间继续延长；
- 同级永久会员不能重复购买；
- 积分不足或等级停用时购买失败；
- 失败不应产生授权、积分扣减或购买流水。

会员等级创建/编辑、积分调整、卡密发行均不通过 MCP 开放。

## 11. 场景七：合同附件安全下载

1. 列出合同：

```bash
slothvault-mcp tools call admin.contract.list \
  --args '{"page":1,"pageSize":50,"keyword":"合同关键字"}' \
  --profile production \
  --json
```

2. 按合同 ID 读取并确认主体、状态和附件摘要：

```bash
slothvault-mcp tools call admin.contract.get \
  --args '{"contractId":"<CONTRACT_DATABASE_ID>"}' \
  --profile production \
  --json
```

注意这里的 `contractId` 参数是合同数据库 ID，即正十进制字符串；输出对象中还存在一个业务合同编号字段 `contractId`，不要混淆。

3. 取得受保护 URI：

```bash
slothvault-mcp tools call admin.contract.attachment.get \
  --args '{"contractId":"<CONTRACT_DATABASE_ID>"}' \
  --profile production \
  --json
```

4. 下载：

```bash
slothvault-mcp resources read \
  'slothvault://contract-attachment/<CONTRACT_DATABASE_ID>' \
  --output ./contract.pdf \
  --profile production \
  --json
```

合同附件必须是 PDF，最大 25 MiB。每次 Resource 读取都会重新验证 MCP Key。

## 12. 场景八：公开主页和菜单

以下写 Tool 虽然不是发布操作，但可能立即改变公开站点：

- `content.project.home.create`
- `content.project.home.update`
- `content.project.menu.create`
- `content.project.menu.update`
- `content.homepage.create`
- `content.homepage.update`

Skill 默认应把它们归入 `live_surface_write`，要求比普通草稿写入更高一级的明确确认。

项目主页示例：

```bash
slothvault-mcp tools call content.project.home.list \
  --args '{"page":1,"pageSize":50,"projectId":"<PROJECT_ID>"}' \
  --profile production \
  --json

slothvault-mcp tools call content.project.home.create \
  --args-file /tmp/slothvault-project-home.json \
  --profile production \
  --yes \
  --json
```

菜单创建参数示例：

```json
{
  "projectId": "<PROJECT_ID>",
  "parentId": null,
  "label": "快速开始",
  "url": "/docs",
  "isExternal": false,
  "weight": 10,
  "status": 1
}
```

菜单只支持两级树。创建子项前先读取父项，确认它属于同一项目且层级合法。外部链接应设置 `isExternal=true` 并由操作者核对域名。

系统首页全局影响最大。Skill 默认只允许 `content.homepage.get`；除非调用者明确启用全局页面写入，否则不调用 create/update。

## 13. 场景九：发布后完整性、存证与运营巡检

### 13.1 发布内容完整性

对每个已发布版本依次调用：

- `content.project.version.get`
- `content.project.version.integrity`
- `content.project.version.manifest`

`integrity.valid=false`、清单哈希不一致或 `issues` 非空都应升级为人工事件，不应尝试通过 MCP 修改发布版本。

### 13.2 存证查询

```bash
slothvault-mcp tools call admin.evidence.list \
  --args '{"page":1,"pageSize":50,"projectId":"<PROJECT_ID>","projectVersionId":"<PROJECT_VERSION_ID>"}' \
  --profile production \
  --json
```

再用 `admin.evidence.get` 读取单条记录。该能力只读数据库索引，不访问链上 RPC，也不能证明当前链上状态。需要链上核验时转交网页后台或独立受控流程。

### 13.3 日常巡检

```bash
slothvault-mcp tools call admin.dashboard.get \
  --args '{"range":30}' \
  --profile production \
  --json

slothvault-mcp tools call admin.settings.get \
  --args '{}' \
  --profile production \
  --json

slothvault-mcp tools call admin.system.update.get \
  --args '{}' \
  --profile production \
  --json
```

设置结果已脱敏；系统更新 Tool 只报告状态，不执行更新。

## 14. Skill 设计契约

### 14.1 建议输入

一个可复用 Skill 至少接受：

| 输入 | 建议默认值 | 说明 |
| --- | --- | --- |
| `profile` | 必填或使用已确认默认 Profile | 不自动猜生产环境 |
| `objective` | 必填 | 例如“创建项目草稿”或“检查用户会员” |
| `dryRun` | `true` | 只发现、读取和生成计划 |
| `allowDraftWrites` | `false` | 是否允许项目/文章草稿写入 |
| `allowLiveSurfaceWrites` | `false` | 是否允许主页、菜单、系统首页写入 |
| `expectedServerName` | `slothvault-admin-mcp` | 身份校验 |
| `expectedMajor` | `3` | MCP server 主版本校验 |
| `outputDirectory` | 私有临时目录 | Resource 下载位置 |
| `humanApproval` | 必填回调 | 每组写操作前确认 |

不要把 MCP Key 作为 Skill 文本输入。Key 只存在于 SlothTool Profile。

### 14.2 允许列表

Skill 应声明本次允许调用的 Tool allowlist。例如“创建项目草稿”只需要：

```text
content.project.list
content.project.get
content.project.create
content.project.version.create_draft
content.project.version.get
content.category.list
content.category.create
content.note.list
content.note.create
content.note.content.list_versions
content.note.content.get
content.note.content.create_draft
content.project.version.check_draft
```

只有在需求明确包含修订时才加入 update Tool。不要把全部 55 个 Tool 一次性授权给每个工作流。

### 14.3 写入前计划

Skill 在首次写入前应向操作者展示：

```text
目标 Profile：production
服务端：slothvault-admin-mcp@3.0.0
计划创建：1 项目、1 草稿版本、2 分类、3 笔记、3 正文
可能影响公开页面：否
不会执行：发布、删除、恢复、会员授予、积分调整
失败策略：立即停止并返回实体 ID 账本
```

确认应覆盖一组明确的写操作。若执行中计划发生变化，例如新增分类或转为公开页面写入，必须重新确认。

### 14.4 幂等与重复检测

推荐业务唯一键：

| 实体 | 重复检测建议 |
| --- | --- |
| 项目 | 去除首尾空白后的精确 `projectName` |
| 项目版本 | 同一 `projectId` 下精确 `version` |
| 分类 | 同一 `projectVersionId` 下精确 `categoryName` |
| 笔记 | 同一 `categoryId` 下精确 `noteTitle` |
| 正文 | 根据 `noteId`、`versionNote` 和内容哈希判断，不按创建时间猜测 |
| 文章 | 精确标题只能作为候选，还需人工确认摘要或目标 |
| 用户 | 优先使用已确认 `userId`；用户名/邮箱必须精确匹配 |

当前 create Tool 本身不是幂等接口。重复检测必须发生在调用前，不能依赖服务端自动去重。

### 14.5 人工交接对象

Skill 遇到以下动作时，应输出交接单而不是尝试变通：

| 动作 | 网页位置 | 交接单必须包含 |
| --- | --- | --- |
| 发布项目版本 | `/admin/mm/projects` | 项目 ID、版本 ID、`check_draft` 结果 |
| 发布/撤回文章 | `/admin/mm/articles` | 文章 ID、会员要求、内容摘要 |
| 创建/编辑会员等级 | `/admin/mm/membership-levels` | 名称、rank、积分价格、有效期、状态 |
| 授予/撤销用户会员 | `/admin/mm/users` | 用户 ID、当前会员、目标等级、到期方式 |
| 调整积分 | `/admin/mm/users` | 用户 ID、当前余额、调整额、业务原因 |
| 发行卡密 | `/admin/mm/gift-cards` | 面额、数量、到期时间、用途 |
| 合同写入与状态变更 | `/admin/mm/contracts` | 合同 ID、主体、目标动作 |
| 删除/恢复实体 | 对应管理页面 | 实体类型、ID、依赖关系、恢复/清理原因 |
| 系统设置与更新 | `/admin/mm/settings` 或受控更新页 | 当前状态、预期变化、回滚方案 |

### 14.6 最终报告模板

```text
结果：成功 / 部分完成 / 已停止 / 等待人工操作
Profile：<脱敏名称，不含 Key>
服务端：slothvault-admin-mcp@3.0.0
只读调用：<数量和名称>
写调用：<数量和名称>
创建实体：<类型、ID、父 ID>
验证结果：<逐项通过/失败>
未执行高风险动作：<列表>
人工交接：<页面、目标 ID、需要确认的动作>
失败恢复：<是否需要网页清理、哪些 ID 已存在>
```

报告不得包含完整 Key、Cookie、完整 Base64、完整敏感参数、完整 Resource 内容或密码。

## 15. 常见失败与处理

| 现象 | 可能原因 | 正确处理 |
| --- | --- | --- |
| `doctor` 退出 3 | Key 错误、禁用、删除、过期，或账号不再是管理员 | 停止并由管理员检查 Key；不尝试 Cookie 回退 |
| 写 Tool 退出 2 | 非交互模式缺少 `--yes` | 重新展示计划并获得确认，不要静默补 `--yes` |
| Tool 退出 5 | Schema 或业务规则失败 | 读取错误对象，修正状态后重新规划 |
| `VERSION_FROZEN` | 目标属于已发布版本 | 停止；从发布版本 clone 新草稿 |
| 创建调用超时 | 结果未知 | 先 list/get 对账，不直接重试 |
| Resource 退出 2 | URI/输出路径不合法或目标已存在 | 修正本地路径；不要覆盖原文件 |
| Resource 退出 4 | MIME/Base64/文件名/大小或协议不匹配 | 不生成目标文件；作为服务端兼容或完整性问题处理 |
| 项目同名 | 已有精确同名项目 | 停止并请求用户决定，不自动复用 |
| 发布前 `ready=false` | 文档树存在阻塞项 | 按 `issues` 的 entity 和 ID 定位；默认只给修复计划 |
| 会员降级购买失败 | 有效高级会员仍存在 | 这是正常保护；等待过期、续费同级/升级，或由管理员替换授权 |
| 永久同级重复购买失败 | 已永久拥有该等级 | 不重试，不扣积分 |

## 16. 安全与清理清单

每次任务结束前确认：

- 没有在命令行、日志、报告或 Git 中出现完整 MCP Key；
- 临时 JSON 参数文件已删除，尤其是包含正文或 Base64 的文件；
- 下载文件只写到明确路径，权限保持私有；
- 没有把 Tool 完整参数、完整结果或 Resource payload 复制进 SlothTool 历史；
- 对所有写入都完成了只读回查；
- 失败时报告了已经创建的实体 ID；
- 没有把“Prompt 已获取”误报为“工作流已执行”；
- 没有把“发布前检查通过”误报为“已经发布”；
- 没有通过直接 HTTP API 绕开 MCP 未开放的高风险边界；
- 短期 Key 已禁用或删除；长期 Key 的到期时间和责任人仍有效。

SlothTool 本地历史只保留脱敏摘要，最多 200 条，不保存完整参数、完整结果、Key 或 Resource 内容。需要清理脱敏历史时：

```bash
slothvault-mcp history clear --yes --json
```

删除 Profile 会删除本地连接配置，但不会撤销服务端 Key；服务端 Key 必须在 SlothVault `/admin/mm/mcp` 单独禁用或删除。

## 17. Reader Check：读者应能直接回答的问题

一份基于本文生成的 Skill 或操作报告，应能让新读者无需额外上下文回答：

1. 如何安全配置 SlothTool Profile，且不把 Key 放进命令行？
2. 如何确认连接的是正确 SlothVault MCP server？
3. 如何从零创建项目、版本、分类、笔记和主正文？
4. 写 Tool 超时后为什么不能直接重试，应如何对账？
5. 为什么获取 Prompt 不等于执行工作流？
6. 如何创建带会员要求的文章草稿？
7. 为什么不能通过 MCP 直接给用户授予会员，正确交接流程是什么？
8. 如何验证会员授予、积分购买和历史授权？
9. 如何安全下载托管文件或合同附件？
10. 哪些 MCP 写入可能立即影响公开页面？
11. 发布前检查和正式发布有什么区别？
12. 部分创建失败后应向操作者报告哪些 ID？

如果 Skill 无法稳定回答其中任何一项，说明其上下文、状态账本或安全边界仍不完整。
