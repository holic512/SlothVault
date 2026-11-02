# SlothVault × SlothTool 集成架构

## 职责边界

| 能力 | 维护方 | 发布单元 | 用户入口 |
| --- | --- | --- | --- |
| 标准 MCP、业务 Tool/Prompt/Resource、Key 和网站 | SlothVault | 应用 Docker/源码 Release | `/mcp`、网站 |
| 连接、发现、调用、审批与配置 | Codex、Claude Code 原生客户端 | 宿主自身 | 原生 Streamable HTTP MCP |
| 智能体业务说明 | SlothVault | `skill-vX.Y.Z` | 手动安装或 SlothTool 受管链接 |
| 主机部署、应用更新与独立菜单 | SlothVault | `deployment-vX.Y.Z` | 独立 Python 脚本与 menu.py |
| 包校验、版本指针、TUI、Skill 链接 | SlothTool | 根包与界面插件 | `slothtool slothvault` / `slothtool sv` |

产品仅支持 Codex、Claude Code 自带的 MCP 客户端，不提供第三方客户端、自建客户端、代理或桥接适配。SlothTool 可选，用于 Skill 安装更新，不参与 MCP 连接、发现或 Tool 调用。Skill 安装和连接配置分别进行；Deployment 不依赖 MCP 接入。

## 原生接入与一次性凭据

管理员明确提交名称和有效期后，服务端仅在该次创建响应返回完整 Key。页面在短暂内存中生成 Codex TOML 和 Claude Code Bash/zsh 命令，两者直连同一 `/mcp`。关闭、确认、切换创建流程和卸载时移除敏感引用。列表和 mutation 缓存仅保留安全元数据，数据库只保存 secret 哈希。

外部地址优先使用严格验证的 `NEXT_PUBLIC_SITE_ORIGIN`，缺失时使用浏览器 origin；显式合法路径前缀保留。当前应用没有 Next.js basePath；路径部署须保证前缀实际路由至应用。地址不从管理员页面、locale、Host 或 Forwarded Header 推导。已有 Key 的接入说明仅展示占位模板，无法恢复明文，也不会静默创建或轮换。

每个 MCP 请求重验 Bearer Key、有效期、启停、账户状态及管理员角色。标准 SDK 协商 MCP 日期协议；身份由 `initialize.serverInfo` 返回，跨工具指导由初始化 `instructions` 提供。宿主审批不会改变服务端权限。`clientInfo.name`、客户端版本和 User-Agent 不参与准入判断。复制配置后仍须在对应宿主确认连接和工具发现。

## 独立包

两模块各自使用 module.json 和 CHANGELOG，以 `package/` 为归档根目录，清单包含归档和逐文件 SHA-256。Skill 保留现有协议主版本字段；Deployment 只声明 Python 3.10+ 和独立入口，不再声明桥协议。README/CHANGELOG 不进入运行归档；Deployment 的 USAGE.md 随包交付，其变化按打包内容准备版本。

SlothTool 只管理 Skill。根 install/update 管理界面；显式 Skill 命令同步独立 Release 和受管链接。Deployment 按安装、更新检查、更新、启动、停止、应用重启和状态拆为七个独立文件，menu.py 提供中文数字菜单。Docker 输出直接显示，移除 Nginx、HTTPS、证书及 JSON 行桥。

应用更新仍检查实际版本、固定目标后确认一次，拉取后激活并重建，再本地核验运行镜像、发布标识和健康。包、宿主、服务端和应用版本分别管理。现有部署的端口和数据目录不因拆分改变。

## 退役和本地遗留数据

独立 Python MCP Client 和旧 `integrations/slothvault-runtime` 整包源码、执行入口和发布入口已退役；当前没有独立客户端、stdio 转发器或兼容路由。

不再生成 `mcp-client-v*` 或 `toolkit-v*` 新 Release，历史 Release 和 Tag 保留。应用版本算法保留退役 workflow 路径的历史识别，避免改变已有提交的版本计数。

已确认没有需要保留扩展接口的外部消费者，直接移除 `/mcp/compatibility`。旧 Python Client 曾在 404 后回退标准握手，此行为仅供迁移诊断，不代表继续维护旧 Client。

代码不会删除机器上的 Profile、调用历史、Key、智能体配置或部署实例。明确清理流程：先验证新的原生连接，列出并备份旧安装和受管链接，逐项选择本地遗留文件；需要撤销旧 Key 时在网站逐个禁用或删除。不要递归删除旧整包根目录，以免包含部署实例或自定义资料。迁移和清理由用户明确操作。

历史规范路径包括 `~/.pipker/slothtool/plugin-configs/slothvault.json`（可能包含旧 Profile 的明文 Key）、`~/.pipker/slothtool/data/slothvault/history.json`（旧调用历史）和 `~/.pipker/slothtool/runtimes/slothvault/components/mcp-client/`（旧独立 Client）。这些路径仅用于人工核对和清理，不是现行读取或执行入口。先核实实际安装归属和备份，再处理明确选择的文件及旧命令链接；保留部署实例、活动 Skill 与用户自定义配置；旧 SlothTool Deployment 包仅通过显式受管清理处理。

附件 Resource 保留鉴权、业务域隔离和大小限制。宿主可读并保存 blob 时使用宿主能力，否则使用网站授权下载。Skill 不保证每个宿主的二进制保存能力相同。

接口见 [PROTOCOL.md](./PROTOCOL.md)，交接见 [SYNC_UPDATES.md](./SYNC_UPDATES.md)。
