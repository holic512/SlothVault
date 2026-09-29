# SlothVault MCP Client Package

本目录是独立的 Python 3.10+ MCP 连接层。服务端业务能力仍在 SlothVault；本脚本负责配置档案、动态发现、调用确认、Prompt、Resource 安全落盘、脱敏历史及兼容检查。直接运行主要用于开发调试，普通用户可用 SlothTool 安装和管理。

## 从源码运行

先在独立虚拟环境安装已锁定并带 SHA-256 的依赖，再执行脚本。脚本不会自行联网安装依赖，也不会修改全局 Python 环境。

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --require-hashes --index-url https://pypi.org/simple -r integrations/mcp-client/requirements.lock
.venv/bin/python integrations/mcp-client/slothvault_mcp.py --help
```

Windows 将 `.venv/bin/python` 换为 `.venv\Scripts\python.exe`。从 SlothTool 安装时，它为 MCP Client 包创建专属虚拟环境，并在 PyPI 连接或 DNS 失败后使用配置的备用镜像重试；哈希或依赖兼容错误不会换源重试。备用镜像可用 `SLOTHTOOL_PYPI_MIRROR` 设置。

```bash
.venv/bin/python integrations/mcp-client/slothvault_mcp.py profile add work --url https://vault.example/mcp --key-stdin --json
.venv/bin/python integrations/mcp-client/slothvault_mcp.py doctor --profile work --json
.venv/bin/python integrations/mcp-client/slothvault_mcp.py tools list --profile work --json
.venv/bin/python integrations/mcp-client/slothvault_mcp.py tools call TOOL_NAME --profile work --args '{}' --yes --json
```

配置位于 `~/.pipker/slothtool/plugin-configs/slothvault.json`，历史位于 `~/.pipker/slothtool/data/slothvault/history.json`。原 `slothvault-mcp` 路径只在规范路径不存在时迁移；新旧路径同时存在时不会覆盖。MCP Key 只能通过隐藏输入、`--key-stdin` 或 `--key-env` 传入，不能作为命令参数。

远端操作先读取受 Bearer Key 保护的 `/mcp/compatibility`，再验证 MCP 握手。版本过低和协议不兼容会阻止操作并返回 `MCP_CLIENT_OUTDATED` 或 `MCP_PROTOCOL_INCOMPATIBLE`。旧服务端 404 时继续握手，并把最低版本标为 `legacy-unverified`。未知 Tool 默认视为写操作，需要交互确认或 `--yes`；Resource 只允许受保护 URI、有限尺寸且不可覆盖现有文件。

通过 SlothTool 可运行 `slothtool sv` 进入管理 TUI，或运行 `slothtool update slothvault --module mcp-client` 单独更新客户端。
