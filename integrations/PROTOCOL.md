# 跨仓库接口协议

机器可读基线位于 [`protocol/contract.json`](./protocol/contract.json)。`component-manifest.schema.json` 和 `compatibility.schema.json` 使用 JSON Schema 2020-12；`python integrations/scripts/validate_protocol.py` 用标准库检查模块元数据、入口及示例。协议主版本是 SlothTool 与包之间的桥接协议，和 MCP 日期协议版本分别管理。

## Release 契约

| 模块 | Tag | 归档 | 清单 | 协议主版本 | 入口 |
| --- | --- | --- | --- | --- | --- |
| MCP Client | `mcp-client-vX.Y.Z` | `slothvault-mcp-client-X.Y.Z.tgz` | `slothvault-mcp-client-manifest.json` | 2 | `slothvault_mcp.py` |
| Skill | `skill-vX.Y.Z` | `slothvault-skill-X.Y.Z.tgz` | `slothvault-skill-manifest.json` | 1 | `slothvault-mcp/SKILL.md` |
| Deployment | `deployment-vX.Y.Z` | `slothvault-deployment-X.Y.Z.tgz` | `slothvault-deployment-manifest.json` | 1 | `install.py` |

SlothTool 只读取非草稿、非预发布的相应 Tag Release。必须先校验清单字段、协议主版本、归档 SHA-256、归档内逐文件 SHA-256 和无额外文件，再运行入口。MCP Python 依赖固定在 `requirements.lock`，安装使用 `pip --require-hashes` 和模块私有 `.venv`。先用官方 PyPI；只有超时、DNS、连接失败才尝试 `SLOTHTOOL_PYPI_MIRROR` 或默认备用镜像。摘要或依赖兼容性错误直接失败。

## HTTP 兼容接口

`GET <mcp-endpoint>/compatibility`，例如 `GET /mcp/compatibility`。与 `POST /mcp` 一样，服务未安装返回 503，Bearer Key 无效或缺失返回 401；成功响应为 200，`Cache-Control: no-store`。请求头使用 `Authorization: Bearer <Key>`，Key 不出现在 URL。成功示例见 [`protocol/examples/compatibility.json`](./protocol/examples/compatibility.json)：

```json
{"schema":1,"serverName":"slothvault-admin-mcp","serverVersion":"3.1.0","minimumClientVersion":"1.0.0","supportedProtocolVersions":["2025-11-25"]}
```

`schema` 不支持、名称错误、版本字段无效时客户端返回 `MCP_COMPATIBILITY_INVALID`。客户端版本低于 `minimumClientVersion` 返回 `MCP_CLIENT_OUTDATED`，支持协议无交集或握手结果不在客户端支持集合时返回 `MCP_PROTOCOL_INCOMPATIBLE`；两者均阻止远端操作。404 视为旧服务端，继续握手，`compatibility.status=legacy-unverified` 且 `minimumClientVersion=null`。旧服务端是否满足最低版本无法断言。服务端认证失败为 `MCP_AUTH_FAILED`，未安装为 `MCP_UNAVAILABLE`。

## Python CLI JSON 桥

运行形式：`python3 slothvault_mcp.py <command> [subcommand] [target] --json`。本地命令为 `config`、`storage status`、`profile list|show|add|update|use|remove`、`history list|show|clear`；远端命令为 `doctor`、`discovery`、`compatibility`、`tools list|show|call`、`prompts list|get`、`resources list|read`。标准输出是一份 JSON 文档；错误格式稳定为 `{"ok":false,"error":{"code":"MCP_CLIENT_OUTDATED","category":"compatibility","message":"..."}}`，进程退出码非零。`setup` 连接失败可返回 `saved:true, connected:false` 且退出码 4，因为档案已保存。Tool 仅在 `annotations.readOnlyHint === true` 时视为只读，其他调用在非交互模式需要 `--yes`。Resource 读取必须提供 `--output`，不得覆盖现有文件。

配置路径：`~/.pipker/slothtool/plugin-configs/slothvault.json`；脱敏历史路径：`~/.pipker/slothtool/data/slothvault/history.json`。SlothTool 通过 stdin 提供 Key，不把原始 Key 放入 TUI state、命令行、日志或结果。状态与档案摘要仅展示掩码。默认情况下客户端不会下载更新；更新由 SlothTool 发起。

## Deployment JSON 行桥

`python3 install.py --bridge --action <action> --root <path>` 输出一行一个 JSON 事件，事件 `type` 包括 `progress`、`log`、`prompt`、`snapshot`、`update`、`preview`、`error`、`done`。示例见 [`protocol/examples/bridge-events.jsonl`](./protocol/examples/bridge-events.jsonl)。`prompt` 事件的 `secret:true` 指示 TUI 隐藏输入；回应是 stdin 的 `{"type":"answer","value":"..."}` 或 `{"type":"cancel"}`。最后 `done.code` 与进程状态一致。`--snapshot-json` 返回一次当前实例快照，其中 `appVersion` 是已部署应用版本；`module.json.version` 是部署脚本包版本，两者不可混用。

## 兼容性演进

同一协议主版本内可新增可选字段；SlothTool 忽略未知可选字段。删除或改变必需字段、CLI 命令含义、事件类型或凭据边界时，先提升相应模块 `bridgeApiMajor`／`protocolMajor`，更新本文件与契约，再发布适配后的 SlothTool。服务端兼容接口 schema 变化须提升 `schema` 并在客户端明确支持；MCP 日期协议交集仍由实际 SDK 握手验证。
