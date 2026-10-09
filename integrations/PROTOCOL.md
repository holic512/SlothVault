# 跨仓库接口协议

机器契约位于 [protocol/contract.json](./protocol/contract.json)，清单采用 JSON Schema 2020-12。`python3 integrations/scripts/validate_protocol.py` 校验两包、入口、服务端身份和部署桥示例。桥主版本与 MCP 日期协议分别管理。

## Release 契约

| 模块 | Tag | 归档 | 清单 | 桥主版本 | 入口 |
| --- | --- | --- | --- | --- | --- |
| Skill | `skill-vX.Y.Z` | `slothvault-skill-X.Y.Z.tgz` | `slothvault-skill-manifest.json` | 1 | `slothvault-mcp/SKILL.md` |
| Deployment | `deployment-vX.Y.Z` | `slothvault-deployment-X.Y.Z.tgz` | `slothvault-deployment-manifest.json` | 1 | `install.py` |

打包器和共享 workflow 仅接受 skill/deployment。消费方读取对应正式 Release，校验清单、桥主版本、归档和逐文件 SHA-256、无额外/危险条目后运行。Skill 不需要 Python；Deployment 为 Python 3.10+ 标准库脚本。清单 schema 保持 1。

## 标准 MCP HTTP

`POST /mcp` 使用 Streamable HTTP 和 `Authorization: Bearer <SlothVault MCP Key>`。Session 不作为 MCP 凭据。每次请求重验 Key 和管理员账户；缺失、无效、过期、停用 Key 或非管理员返回 401，未安装/维护返回 503，现有维护锁保留。

SDK 初始化协商日期协议，当前 serverInfo 为 `slothvault-admin-mcp@4.0.0`。clientInfo.name 不要求专用名称，不比较 Codex、Claude Code 版本与退役 Client 版本。instructions 提供业务指导。67 个 Tool、4 个 Prompt、2 个 Resource 模板按实时目录发现。当前无独立 SSE 会话流，GET/DELETE 返回 405；宿主可通过 POST 完成发现、调用与 Resource 读取。

`/mcp/compatibility`、最低 Client 版本常量及 schema 已移除，无已知外部消费者需要过渡。旧 Python Client 在 404 后的握手回退仅供迁移诊断，其源码与发布入口不再保留。

Tool schema、annotations 和 Service 定义业务边界。Resource 二进制内容在标准 blob 中，文件名位于 `_meta["slothvault/file-name"]`。URI 不是公开下载链接；不能保存二进制时使用网站授权下载。

## Key 管理边界

`/api/admin/mm/mcp/keys` 使用管理员 Session，按所有者隔离。POST 仅一次返回完整 Key，GET、状态更新、删除不提供明文恢复。集合与详情响应使用 `Cache-Control: private, no-store`。纯配置生成器不访问网络或存储，Key 不进入 mutation 结果或持久化；复制由用户点击触发。

## Deployment JSON 行桥

`python3 install.py --bridge --action <action> --root <path>` 输出一行一个 JSON 事件：progress、log、prompt、snapshot、update、preview、error、done，见 [示例](./protocol/examples/bridge-events.jsonl)。prompt.secret:true 要求隐藏输入；stdin 回应为 `{"type":"answer","value":"..."}` 或 `{"type":"cancel"}`。done.code 与进程状态一致。

`--snapshot-json` 的 appVersion 是已部署应用版本，module.json.version 是脚本包版本。桥、归档和部署能力不变。同一主版本可新增可选字段；改变必需字段或事件语义时提升主版本并协调消费方。MCP 标准协商独立于部署桥。
