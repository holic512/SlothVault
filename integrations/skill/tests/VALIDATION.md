# MCP 5 / Skill 1.2 验证记录

日期：2026-10-09。基线提交：`9b964400cf992e38864f6aad63590e392ec3e6f0`。实施开始时工作区干净；之前用户的委托流程修改已包含在基线提交中。本文件为开发验证记录，位于打包器排除的 tests 目录，不加载进运行 Skill。

## 已执行检查

- 6 个相关 TypeScript 测试文件共 56 个用例通过（首次 55 个通过；修正新增测试中 Date 与 JSON 字符串的比较后，MCP 文件 28 个用例全部通过）。
- 独立包及文章静态脚本：18 个 Python unittest 通过。
- `npm run typecheck`、变更 TypeScript 文件 ESLint、`npm run build`（含三种 Prisma 客户端生成、Next 构建和 postbuild）通过。
- Skill quick_validate、集成协议、`npm run mcp:docs:check` 通过。
- 真实数据库回归使用隔离临时 SQLite；未连接线上数据库，未运行 PostgreSQL/MySQL 数据库实例测试。构建验证了三种生成客户端。
- 后台列表/详情边界通过 API 测试、类型检查和构建验证；未做浏览器交互或真实宿主模型评估。

## MCP 响应体积

固定 20 篇文章，每篇正文 20,000 个中文字符；元数据相同。新输出由真实 MCP SDK JSON-RPC 测试请求生成，旧输出按改动前的完整文章 Schema 重建，均计入文本块、structuredContent 与 JSON-RPC 包装。服务测试另行断言数据库查询未选取正文。

| 场景 | 业务调用数 | 完整响应 UTF-8 字节 |
| --- | ---: | ---: |
| 旧列表（可从中读取目标正文） | 1 | 2,414,693 |
| 新列表，仅定位 | 1 | 14,093 |
| 新列表＋读取一个详情 | 2 | 134,912 |

仅列表减少 **99.42%**；列表＋一个详情相对旧列表减少 **94.41%**。这不是线上延迟或真实 Token 测量。旧流程按能复用列表正文的最优情况计为一次调用，未人为假设旧 Skill 必然重复读取详情。

## Skill 上下文

按明确路由相加文件 UTF-8 字节，不把教材默认加载到所有任务。以下只计指引，不含业务数据、工具 Schema、文章正文或宿主历史。

| 路由 | 修改前字节 | 修改后字节 |
| --- | ---: | ---: |
| entry_only | 5329 | 4316 |
| project_workflow | 7233 | 7211 |
| project_materials | 7664 | 6651 |
| article_edit | 新增能力，无等价基线 | 9944 |
| technical_article | 新增能力，无等价基线 | 15425 |

入口减少 **19.01%**。项目资料路径未包含实际上传时才需要的附件参考。新增文章工作流和教材的专项开销单列，不能宣称所有任务的上下文都减少。脚本直接执行，不要求读取其源码。

## 检查器吞吐

环境：Python 3.14.7，Darwin/arm64。每种输入预热一次后测量 9 次取中位数；不含解释器启动、文件读取和 JSON 输出。unique_prose 为独立段落，duplicate_prose 为重复段落，code_spans 为包含不同长度反引号的行内代码；unclosed_links 为连续未闭合方括号，spaced_heading 为单行超长空白标题，用于检查退化输入。

| 输入 | 字符数 | 中位耗时 ms | 问题数 |
| --- | ---: | ---: | ---: |
| unique_prose | 5000 | 0.262 | 0 |
| duplicate_prose | 5000 | 0.269 | 29 |
| code_spans | 5000 | 1.084 | 0 |
| unclosed_links | 5000 | 0.223 | 0 |
| spaced_heading | 5000 | 0.162 | 1 |
| unique_prose | 50000 | 2.75 | 0 |
| duplicate_prose | 50000 | 2.71 | 307 |
| code_spans | 50000 | 10.388 | 0 |
| unclosed_links | 50000 | 2.1 | 0 |
| spaced_heading | 50000 | 1.681 | 1 |
| unique_prose | 500000 | 27.695 | 0 |
| duplicate_prose | 500000 | 29.271 | 3085 |
| code_spans | 500000 | 102.836 | 0 |
| unclosed_links | 500000 | 20.999 | 0 |
| spaced_heading | 500000 | 16.508 | 1 |

这些样本中，输入扩大 100 倍时耗时接近同比增长，未出现明显平方级增长；不能推断所有 Markdown 都已覆盖。重复段落使用哈希索引，无两两比较。脚本不是完整 CommonMark 解析器，复杂嵌套/HTML/链接仍需人工复核。

## 固定流程走查

以下为依据真实 Tool Schema 的人工流程走查，不是模型自动执行的成功率测试。调用预算不含首次工具发现；需要发布前额外读取、歧义或外部变化时可合理增加。

| 场景 | 走查的调用与停止条件 | 结论 |
| --- | --- | --- |
| 已知 ID 编辑 | get → update；成功返回用于核对，不强制再 get | 正文和元数据均可按需更新，无列表查询 |
| 多候选查重 | list 分页 → 仅相关 get；仍歧义则停写并澄清 | 不按近似标题覆盖，不额外 create |
| create 超时 | list → 候选 get；唯一匹配则恢复到已保存状态，否则停写 | 无盲目重放；未承诺幂等 |
| upload 超时 | list 文件 → 必要时 get；元数据不能确定身份则停写 | 不按文件名自动视为同一文件 |
| 编辑已发布文章 | get → update；保留发布状态 | 不 clone、不自动 withdraw/publish |
| 撤回后再发布 | 读取 status=0/publishedAt 非空 → publish → 核对返回 | 不因历史 publishedAt 跳过再发布 |
| 仅改元数据 | get → update 变更字段；无变化则跳过 update | 不加载教材、不运行正文检查 |

项目版本仍使用 check_draft 和发布后 integrity，附件仍走鉴权 Resource；没有为了减少调用去掉这些必要保障。

## 重现

```bash
npx vitest run src/server/services/admin-articles.test.ts src/server/services/content-publication.integration.test.ts src/server/mcp/server.test.ts src/server/mcp/registry.contract.test.ts src/app/mcp/route.test.ts src/app/api/admin/mm/article/route.test.ts
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s integrations/scripts/tests
PYTHONDONTWRITEBYTECODE=1 python3 integrations/scripts/benchmark_article_skill.py --baseline-ref 9b964400cf992e38864f6aad63590e392ec3e6f0
python3 integrations/scripts/validate_protocol.py
npm run mcp:docs:check
npm run typecheck
npm run build
git diff --check
```

MCP 性能用例会输出 `[article-payload-benchmark]`，Skill 基准脚本输出 JSON。不要据此宣称模型成功率或 Token 成本已实测。

## 保留边界

列表移除 content 是明确的业务契约迁移，旧调用方须用详情工具。MCP 传输协议、鉴权、维护锁和生命周期事务未改。Skill 无法消除并发覆盖或重复创建，静态检查无法证明技术准确性。公开文章列表的默认摘要生成保持原状，不计入本次收益。没有新增依赖、数据库迁移或线上发布。

## 原生宿主接入补充验证

日期：2026-10-09。本阶段在上述未提交改动基础上实施，只调整支持范围文案、Skill 与 SDK 协议测试，保留 MCP 5.0.0、Skill 1.2.0 和根应用版本。未修改用户原生客户端配置或已安装 Skill，未执行线上写入。

采用统一支持声明与局部测试整理；不增加客户端名称白名单或双宿主适配层。产品仅维护 Codex / Claude Code 自带的 MCP 客户端接入；服务器仍按标准 MCP 和管理员 Key 处理请求，自报名称、版本及 User-Agent 不是身份凭据。

### 本阶段实测

- 以下 9 个 Vitest 文件共 **105 个用例通过**。完整发现/读取流程由三份同构测试合为一份；三组轻量身份测试验证不同自报名称、版本和 User-Agent 下，合法 Key 得到相同业务结果、无效 Key 返回 401。安全用例保留。
- 独立包与离线脚本 **18 个 unittest 通过**，包含归档完整性、参考链接、系统文件排除和从独立归档运行脚本。
- `npm run typecheck`、变更 TypeScript 的 ESLint、集成协议、Skill 格式、MCP 文档生成一致性和 `git diff --check` 通过。
- 对本阶段开始时保存的 11 个文件进行 SHA-256 比较，配置生成器、一次性 Key 生命周期、鉴权、MCP 路由/注册表/服务身份、Key 服务、历史版本算法、根依赖与 Skill 模块版本均未变化。
- 本阶段没有修改生产业务控制流、依赖或构建配置，因此未重复运行上一阶段已通过的生产构建。

```bash
npx vitest run src/server/mcp/server.test.ts src/server/mcp/registry.contract.test.ts src/app/mcp/route.test.ts src/lib/mcp-connection-config.test.ts src/lib/mcp-key-creation.test.ts src/server/services/mcp-api-keys.test.ts src/app/api/admin/mm/mcp/keys/route.test.ts src/i18n/messages.test.ts scripts/release-version.test.mjs
npx eslint src/server/mcp/server.test.ts
npm run typecheck
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s integrations/scripts/tests
python3 integrations/scripts/validate_protocol.py
npm run mcp:docs:check
git diff --check
```

Skill 格式检查使用本机 `skill-creator/scripts/quick_validate.py`，参数为 `integrations/skill/slothvault-mcp`；该验证器不是项目运行依赖。

### 上下文增量

以下仍按文件 UTF-8 字节相加，不代表实测 Token。四份参考资料内容保持本阶段开始时的版本，尺寸分别为 native-workflows 2,895、project-materials 2,335、article-workflow 5,628、technical-writing 5,481 字节。

| 路由 | 原始基线 | 上一阶段 | 本阶段 |
| --- | ---: | ---: | ---: |
| entry_only | 5,329 | 4,316 | 4,775 |
| project_workflow | 7,233 | 7,211 | 7,670 |
| project_materials | 7,664 | 6,651 | 7,110 |
| article_edit | 无等价基线 | 9,944 | 10,403 |
| technical_article | 无等价基线 | 15,425 | 15,884 |

为明确原生客户端边界、连接恢复和二进制能力，入口相对上一阶段增加 **459 字节（10.63%）**，相对原始入口仍减少 **554 字节（10.40%）**。项目工作流的指引总量比原始基线增加，不宣称所有路径均有性能提升。文章列表响应的本轮测试仍输出 **2,414,693 → 14,093 字节**，列表加一篇详情为 **134,912 字节**；检查器未修改，不重复测量吞吐。

### 接入与恢复走查

以下为人工语义走查，不是模型成功率测试：

| 场景 | 当前指导 |
| --- | --- |
| 工具不可见 | 先检查当前宿主配置、启用与发现；缺配置时使用网站接入说明，不创建临时客户端 |
| 写入结果不明并断连 | 先恢复连接，再按记录的实体 ID 或候选查询确认结果；不重放整套创建流程 |
| 宿主不能保存 Resource blob | 使用网站授权下载；本地文章检查器仍可离线使用，不承担 MCP 连接职责 |

本机 CLI 帮助核对版本为 Codex 0.149.1、Claude Code 2.1.191。Context7 返回的 Codex 官方资料支持 HTTP URL、请求头和超时字段；官方网页直连超时、Claude 文档查询遇到 npm 缓存锁错误，Claude 命令因此以本地帮助和现有转义测试交叉验证。没有完整重验两种产品的全部配置语义；配置字段、审批默认值、超时和 Shell 参数未改。

SDK 测试在进程内调用路由并模拟业务依赖，没有启动真实 Codex / Claude Code，也没有验证其线上连接、Tool 调用或二进制保存。旧组件名称仅在集中迁移说明、历史版本分类及退役模块拒绝测试中保留；Deployment 的 Python 和 JSON 行桥继续用于部署。无删除、迁移用户数据或创建 Commit、Tag、Release 的操作。
