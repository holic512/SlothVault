# Vault → SlothTool 同步更新说明

本目录是两个工作区的交接入口。后续处理 Vault 侧变更时，先读 [ARCHITECTURE.md](./ARCHITECTURE.md)、[PROTOCOL.md](./PROTOCOL.md)、`protocol/contract.json`，再按下表确定 SlothTool 适配范围。不要仅凭 Release 标题推断协议或路径。

| Vault 变更 | 必须更新的版本与文件 | SlothTool 适配 |
| --- | --- | --- |
| MCP Client 命令、输出或依赖 | `mcp-client/module.json`、`CHANGELOG.md`、必要时桥协议主版本 | Python 适配器、虚拟环境安装、MCP 页、目标测试 |
| Skill 内容 | `skill/module.json`、Skill frontmatter 版本、`CHANGELOG.md` | Skill 链接状态与更新页；自定义目标仍保留 |
| 部署程序或 JSON 行事件 | `deployment/module.json`、`CHANGELOG.md`、必要时桥协议主版本 | 部署适配器、部署页与事件处理 |
| 服务端最低客户端版本或 MCP 日期协议 | 应用版本、`/mcp/compatibility` 与兼容测试 | 不兼容提示及可更新包检查；最新仍不兼容则保持阻止 |
| Release 清单字段或路径 | `protocol/contract.json`、JSON Schema、打包脚本 | 下载、校验、暂存、回退代码和测试 |

## 本次同步基线（2026-09-30）

| 模块 | Vault 版本 | 桥协议主版本 | SlothTool 适配 |
| --- | --- | --- | --- |
| MCP Client | 1.0.0 | 2 | Python 3.10+，`mcp==1.30.0`，源脚本与私有 `.venv`，兼容接口预检 |
| Skill | 1.0.0 | 1 | 手动复制或 Codex/Claude 受管链接，保留自定义 Skill |
| Deployment | 1.0.0 | 1 | Python 3.10+，保留 JSON 行事件桥，包版本与应用版本分开显示 |

SlothTool 根包目标版本 `2.7.1`，SlothVault 插件目标版本 `2.3.0`。`slothtool install slothvault` 预备三包，`slothtool update slothvault` 更新三包与 UI 插件，`--module` 逐包处理；`slothtool sv` 是同一插件的非弃用简写。旧 `toolkit-v` 发布停止，旧安装目录仍保留为迁移回退来源。现有 `~/.pipker` 配置和历史不随包卸载或升级清空。

## 每次同步步骤

1. 确认 Vault 三个 `module.json` 及 `CHANGELOG.md` 的版本一致，运行 `python integrations/scripts/validate_protocol.py`；检查对应 Tag 是否已存在且该版本的包内容未变化。
2. 核对 `/mcp/compatibility`、Python CLI `--json` 输出和部署桥事件；如有契约变更，更新 `protocol/contract.json`、Schema、示例及本表。先为 SlothTool 提供兼容适配，再提升桥协议主版本。
3. 在 SlothTool 调整 `lib/services/slothvault-components.js`、`plugins/slothvault/lib/runtime-adapter.js`、部署/Skill 管理模块和相应 TUI 页面；更新根包、插件版本及锁文件。
4. 用隔离 HOME 验证首次三包安装、逐包更新、旧整包受管 Skill 链接迁移、失败回退、配置/历史沿用、`slothtool sv`、自定义 Skill 保留。生产凭据不得进入测试输出。
5. 分别验证三包归档和清单、Vault 服务端测试与构建、SlothTool 目标测试及 TUI 烟雾检查；记录实际通过的检查。只修改文档时不重复发布已有 Tag。

发布是三个独立 GitHub Release。每个 Release 正文由模块 `CHANGELOG.md` 的对应版本小节生成，并列出源码提交、归档名称、SHA-256、协议主版本及已通过检查。应用 Docker Release 使用应用版本规则，不能让独立包 Action 回写应用版本或 Git 历史。
