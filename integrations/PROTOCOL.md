# 跨仓库接口协议

机器契约位于 [protocol/contract.json](./protocol/contract.json)，清单采用 JSON Schema 2020-12。`python3 integrations/scripts/validate_protocol.py` 校验两包、入口、服务端身份和部署桥示例。桥主版本与 MCP 日期协议分别管理。

## Release 契约

| 模块 | Tag | 归档 | 清单 | 桥主版本 | 入口 |
| --- | --- | --- | --- | --- | --- |
| Skill | `skill-vX.Y.Z` | `slothvault-skill-X.Y.Z.tgz` | `slothvault-skill-manifest.json` | 1 | `slothvault-mcp/SKILL.md` |
| Deployment | `deployment-vX.Y.Z` | `slothvault-deployment-X.Y.Z.tgz` | `slothvault-deployment-manifest.json` | 1 | `install.py` |

打包器和共享 workflow 仅接受 skill/deployment。消费方读取对应正式 Release，校验清单、桥主版本、归档和逐文件 SHA-256、无额外/危险条目后运行。Skill 连接与普通操作不需要 Python；可选文章静态检查脚本使用 Python 3.10+ 标准库；Deployment 为 Python 3.10+ 标准库脚本。清单 schema 保持 1。

发布正文采用所属发布单元的完整 Git 提交消息，构建信息独立放在 Actions Summary。模块正式 Release 不标记为 Latest；已发布产物只读核验，草稿仅在原目标提交及已有附件哈希一致时恢复。应用的双架构镜像与发布恢复规则见 [发布流程](../docs/releasing.md)。

## 标准 MCP HTTP

`POST /mcp` 使用 Streamable HTTP 和 `Authorization: Bearer <SlothVault MCP Key>`。Session 不作为 MCP 凭据。每次请求重验 Key 和管理员账户；缺失、无效、过期、停用 Key 或非管理员返回 401，未安装/维护返回 503，现有维护锁保留。

SDK 初始化协商日期协议，当前 serverInfo 为 `slothvault-admin-mcp@5.1.0`。产品仅支持 Codex、Claude Code 原生 MCP 客户端；服务端按管理员 MCP Key 鉴权，不以 clientInfo.name、客户端版本或 User-Agent 判断准入。instructions 提供业务指导。65 个宿主 Tool（启用插件可动态贡献额外工具）、4 个 Prompt、1 个 Resource 模板按实时目录发现。当前无独立 SSE 会话流，GET/DELETE 返回 405；宿主可通过 POST 完成发现、调用与 Resource 读取。

退役客户端、兼容路由与本地数据的迁移说明统一见 [集成架构](./ARCHITECTURE.md#退役和本地遗留数据)。

Tool schema、annotations 和 Service 定义业务边界。Resource 二进制内容在标准 blob 中，文件名位于 `_meta["slothvault/file-name"]`。URI 不是公开下载链接；不能保存二进制时使用网站授权下载。

## Key 管理边界

`/api/admin/mm/mcp/keys` 使用管理员 Session，按所有者隔离。POST 仅一次返回完整 Key，GET、状态更新、删除不提供明文恢复。集合与详情响应使用 `Cache-Control: private, no-store`。纯配置生成器不访问网络或存储，Key 不进入 mutation 结果或持久化；复制由用户点击触发。

## Deployment JSON 行桥

`python3 install.py --bridge --action <action> --root <path>` 输出一行一个 JSON 事件：progress、log、prompt、snapshot、update、preview、error、done，见 [示例](./protocol/examples/bridge-events.jsonl)。prompt.secret:true 要求隐藏输入；stdin 回应为 `{"type":"answer","value":"..."}` 或 `{"type":"cancel"}`。done.code 与进程状态一致。

Deployment 1.1.0 在主版本 1 内增加可选字段：

- `prompt.kind: "confirm"` 和 `default` 支持 y/n 即时确认；无 kind 的旧提示继续输入后 Enter。普通和 secret 输入不变。
- `preview.data` 包含 `currentVersion`、`targetVersion`、`image`、`root`、`impact` 与 `releaseCount`。确认后目标固定。
- `progress` 可含 `stageIndex/stageCount`、`subject`、`current/total/unit`、`speed`、`status` 与安全 `message`。`heartbeat: true` 表示进程存活，不是业务进度。百分比只能由可靠的镜像层总量推导。
- `done` 可含 `outcome: updated/unchanged/cancelled/failed`、`beforeVersion`、`targetVersion`、`currentVersion`、`verified` 和 `health`。其他动作可省略 outcome；真实退出码优先于事件。版本未核验不能报告应用更新成功。
- `snapshot.data.runtimeImage` 为实际应用容器使用的镜像；原 `image` 为配置镜像。`appVersionSource` 区分嵌入发布标识与镜像 tag 回退；仅镜像 tag 回退不能证明更新目标已生效。取消和失败也提供最终 snapshot，读失败记录在 errors。

`--snapshot-json` 的 appVersion 是实际容器版本，module.json.version 是脚本包版本。应用更新核验实际运行、目标镜像、发布标识及健康；不存在健康检查时明确记录，有检查最多等待 120 秒。核验不重新查询 GitHub。同一主版本可新增可选字段；改变必需字段或事件语义时提升主版本并协调消费方。MCP 标准协商独立于部署桥。

Deployment 1.1.2 将参数解析纳入桥事件边界：未知命令、未知参数及参数缺值产生 `DEPLOYMENT_ARGUMENT_ERROR`，最终 `done.code` 与实际退出码一致；`--bridge --help` 和 `--bridge --version` 以 0 结束。消费方在启动部署操作前可用普通 `--help` 核对安装包声明的动作与参数，避免独立更新的界面调用旧包不支持的功能。

## MCP 5.0 文章列表迁移

`content.article.list` 的列表项移除 `content`，其余元数据与分页不变；读取正文使用 `content.article.get`。后台文章管理列表采用相同分离，详情和写入返回保留正文。升级后宿主应重新发现工具 Schema；这项业务契约变化不改变 MCP 日期协议、Key 鉴权或 Resource 契约。

## Deployment 1.1.1 Nginx inspection

Bridge major 1 remains unchanged. Actions add `nginx-discover`, `nginx-status` and `nginx-update`; selectors add `--nginx-config`, `--nginx-site` and `--nginx-server-name`. `preview.data.nginxStatus` and `snapshot.data.nginx` optionally contain instances (mode, container, running, mainConfig, version, syntax, mounts, error), sites (siteConfig, hostConfig, serverNames, upstreams, loaded, writable, HTTPS and transfer routes). `preview.data.changes` contains only policy, directive and new value, not raw configuration. Existing consumers may ignore these fields. Status reports unavailable or unknown when the context cannot be verified.

Deployment 1.1.3 adds optional `instances[].parseError` with `path` and `line` when the script parser rejects a loaded source. `error: CONFIG_PARSE_FAILED` distinguishes this from native command/configuration failures; `syntax: passed` records a successful native `nginx -t` even when parsing fails. Error metadata does not contain configuration values. Bridge major 1 is unchanged.
