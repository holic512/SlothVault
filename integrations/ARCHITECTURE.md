# SlothVault × SlothTool 集成架构

## 职责边界

| 能力 | 所属仓库 | 发布单元 | 用户入口 |
| --- | --- | --- | --- |
| 管理员 MCP 服务端、业务 Tool/Prompt/Resource、部署应用 | SlothVault | 应用 Docker/源码 Release | `/mcp`、网页 |
| MCP 连接、配置档案、调用确认、安全下载、脱敏历史 | SlothVault | `mcp-client-vX.Y.Z` | Python 脚本或 SlothTool 适配器 |
| 智能体操作说明 | SlothVault | `skill-vX.Y.Z` | 手动复制或 SlothTool 管理链接 |
| 主机部署、应用更新、JSON 行事件桥 | SlothVault | `deployment-vX.Y.Z` | Python 脚本或 SlothTool 管理页 |
| 下载校验、版本指针、TUI、命令注册、Skill 链接 | SlothTool | 根包与 SlothVault 插件 | `slothtool sv` |

旧 `integrations/slothvault-runtime` 只作为迁移期的回退来源保留，`toolkit-v*` 不再发布。新模块均从 `1.0.0` 开始独立递增。应用版本仍由应用文件提交决定；只修改 `integrations/` 或这三个模块的发布 workflow，不触发 Docker 应用发布。服务端 `/mcp/compatibility` 属于应用边界，修改它按应用版本规则处理。

## 包结构与安装

每个模块的 `module.json` 提供模块名、版本、桥协议主版本和最低 Python 版本；`CHANGELOG.md` 的同版本小节提供 Release 变更说明。`README.md` 和 `CHANGELOG.md` 留在源码中，不进入运行归档；仅修改文档不重发同版本包。独立 Action 以固定的 `package/` 根打出 `slothvault-<module>-<version>.tgz`，发布同名 `slothvault-<module>-manifest.json`。清单含归档 SHA-256、逐文件 SHA-256、`protocolMajor` 与 `bridgeApiMajor`。SlothTool 先下载三个清单和归档、校验摘要和文件列表，为 MCP Client 创建独立 `.venv` 并使用 `--require-hashes` 安装依赖，再切换各模块 `current` 指针。首次安装若任一包准备失败，不切换任何运行指针；逐包更新失败时旧指针仍可用。

版本目录：`~/.pipker/slothtool/runtimes/slothvault/components/<module>/releases/<version>`。`current` 指向验证过的版本。旧整包目录 `~/.pipker/slothtool/runtimes/slothvault/` 保留供迁移回退，不作为新执行入口。已有配置档案和历史继续留在原规范路径，新包不会清空或重置。已验证属于旧整包的 Codex/Claude Skill 链接可改指新 Skill；自定义目录或其他链接保持原样。

SlothTool 根注册表仅保留 `slothvault` 一项，`sv` 是非弃用命令别名，`slothvault-mcp` 是兼容旧命令别名。`slothtool install slothvault` 安装 UI 插件及三包；`slothtool update slothvault --check` 与 `slothtool update slothvault` 统一检查、更新；`--module mcp-client|skill|deployment` 定向处理。`slothtool sv` 打开管理 TUI。插件 UI 的 MCP、Skill、部署页分别展示包版本、检查状态和更新结果；部署页另显示已部署应用版本。

## 运行边界

MCP Client 只进行连接与本地安全控制，不内置业务 Tool 名称。远端操作先调用受 Bearer Key 保护的 `/mcp/compatibility`，再执行 MCP 握手并验证服务端名称、协议交集；版本过低或协议不兼容时阻止操作，SlothTool 提供更新入口。旧服务端 404 回退到握手，最低客户端版本显示“未验证”。即使最新包仍不满足服务端要求，也继续阻止远端操作。MCP Key 只经 stdin、隐藏终端输入或环境变量进入客户端，不通过命令参数、TUI 状态或历史输出。

Skill 仅提供可复制内容；智能体探测、链接安装及冲突处理由 SlothTool 执行。部署包是纯 Python 标准库程序，SlothTool 只负责调用和展示 JSON 行事件，不重新实现部署逻辑。协议细节见 [PROTOCOL.md](./PROTOCOL.md)，跨仓库变更步骤见 [SYNC_UPDATES.md](./SYNC_UPDATES.md)。
