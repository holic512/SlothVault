# SlothVault Skill Package

此包仅包含 Skill 内容和 module.json，当前版本 **1.1.0**，桥主版本 **1**。Skill 使用宿主已连接并发现的 SlothVault 原生 MCP 工具；网站管理员 MCP Key 页提供接入配置。连接无需 SlothTool 或专用 Python 包。

手动安装时，将 `slothvault-mcp` 整个目录复制到用户级 Skill 目录，例如 `$CODEX_HOME/skills/slothvault-mcp`（默认 `~/.codex/skills/slothvault-mcp`）或 Claude Code 的 `~/.claude/skills/slothvault-mcp`。先检查已有自定义内容，避免覆盖。

SlothTool 当前独立管理 Skill 和 Deployment；根安装命令管理界面插件，Skill 使用：

```bash
slothtool slothvault skill status --check --json
slothtool slothvault skill install
slothtool slothvault skill update
```

命令下载、校验独立 Skill 包并同步受管链接，无需 Client。目录和 Skill 名称保持不变；自定义文件由用户处理。契约见 [PROTOCOL.md](../PROTOCOL.md)。

发布前运行 `python3 -m unittest discover -s integrations/scripts/tests` 和协议校验。拟发布 `skill-v1.1.0`；本轮仅本地代码、验证和归档，实际 Release 须绑定最终提交，不重复发布已有 Tag。
