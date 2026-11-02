# 跨仓库接口协议

机器契约位于 [protocol/contract.json](./protocol/contract.json)，清单采用 JSON Schema 2020-12。`python3 integrations/scripts/validate_protocol.py` 校验两包、全部独立操作入口与服务端身份。Deployment 不提供桥协议。

## Release 契约

| 模块 | Tag | 归档 | 清单 | 桥主版本 | 入口 |
| --- | --- | --- | --- | --- | --- |
| Skill | `skill-vX.Y.Z` | `slothvault-skill-X.Y.Z.tgz` | `slothvault-skill-manifest.json` | 1 | `slothvault-mcp/SKILL.md` |
| Deployment | `deployment-vX.Y.Z` | `slothvault-deployment-X.Y.Z.tgz` | `slothvault-deployment-manifest.json` | 无 | `menu.py` |

打包器和共享 workflow 仅接受 skill/deployment。消费方读取对应正式 Release，校验清单、归档和逐文件 SHA-256；Skill 另校验其现有协议主版本，拒绝额外/危险条目后运行。Skill 连接与普通操作不需要 Python；可选文章静态检查脚本使用 Python 3.10+ 标准库；Deployment 为 Python 3.10+ 标准库脚本。清单 schema 保持 1。

发布正文采用所属发布单元的完整 Git 提交消息，构建信息独立放在 Actions Summary。模块正式 Release 不标记为 Latest；已发布产物只读核验，草稿仅在原目标提交及已有附件哈希一致时恢复。应用的双架构镜像与发布恢复规则见 [发布流程](../docs/releasing.md)。

## 标准 MCP HTTP

`POST /mcp` 使用 Streamable HTTP 和 `Authorization: Bearer <SlothVault MCP Key>`。Session 不作为 MCP 凭据。每次请求重验 Key 和管理员账户；缺失、无效、过期、停用 Key 或非管理员返回 401，未安装/维护返回 503，现有维护锁保留。

SDK 初始化协商日期协议，当前 serverInfo 为 `slothvault-admin-mcp@5.2.0`。产品仅支持 Codex、Claude Code 原生 MCP 客户端；服务端按管理员 MCP Key 鉴权，不以 clientInfo.name、客户端版本或 User-Agent 判断准入。instructions 提供业务指导。67 个宿主 Tool（启用插件可动态贡献额外工具）、4 个 Prompt、1 个 Resource 模板按实时目录发现。当前无独立 SSE 会话流，GET/DELETE 返回 405；宿主可通过 POST 完成发现、调用与 Resource 读取。

退役客户端、兼容路由与本地数据的迁移说明统一见 [集成架构](./ARCHITECTURE.md#退役和本地遗留数据)。

Tool schema、annotations 和 Service 定义业务边界。Resource 二进制内容在标准 blob 中，文件名位于 `_meta["slothvault/file-name"]`。URI 不是公开下载链接；不能保存二进制时使用网站授权下载。

## Key 管理边界

`/api/admin/mm/mcp/keys` 使用管理员 Session，按所有者隔离。POST 仅一次返回完整 Key，GET、状态更新、删除不提供明文恢复。集合与详情响应使用 `Cache-Control: private, no-store`。纯配置生成器不访问网络或存储，Key 不进入 mutation 结果或持久化；复制由用户点击触发。

## 独立 Deployment 命令

完整归档解压后执行 `python3 menu.py`，或直接运行 install.py、check_update.py、update.py、start.py、stop.py、restart.py、status.py。各操作暴露 `main(argv=None) -> int`，支持 `--root`、`--help`、`--version`；退出码为成功 0、操作失败 1、参数错误 2、中断 130。菜单保留当前目录并在操作结束后重新显示。

Deployment 元数据和清单保留 schema 1、module、version、minPython 及 SHA-256 文件清单，不再包含 bridgeApiMajor 或 protocolMajor。归档包含 menu.py、七个操作脚本、共享标准库模块与 USAGE.md；完整性检查要求所有入口齐全。Skill 清单兼容字段保持原样。

旧 --action、--bridge、--snapshot-json 与 Nginx/HTTPS/证书操作已移除。重启仅作用于 slothvault 应用。现有 Compose 标记、端口与数据配置保持兼容；更新固定目标版本，拉取后激活并核验本地运行镜像、发布标识及健康，具体见 [随包说明](deployment/USAGE.md)。

## MCP 5.0 文章列表迁移

`content.article.list` 的列表项移除 `content`，其余元数据与分页不变；读取正文使用 `content.article.get`。后台文章管理列表采用相同分离，详情和写入返回保留正文。升级后宿主应重新发现工具 Schema；这项业务契约变化不改变 MCP 日期协议、Key 鉴权或 Resource 契约。

### Markdown extensions

MCP 5.2 adds read-only `content.markdown.capabilities` and `content.markdown.validate`. Existing body writes retain string inputs. Capability discovery includes schemas, presets, quotas, thumbnail behavior and fallbacks. Static validation neither renders nor authorizes publication.
