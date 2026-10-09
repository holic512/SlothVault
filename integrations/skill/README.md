# SlothVault Skill Package

此包包含 Skill、按需参考资料、可选静态检查脚本和 module.json，当前版本 **1.2.0**，桥主版本 **1**。Skill 仅面向 Codex、Claude Code，使用当前宿主已连接并发现的 SlothVault 原生 MCP 工具；网站管理员 MCP Key 页提供接入配置。连接无需 SlothTool 或专用 Python 包。

手动安装时，将 `slothvault-mcp` 整个目录复制到用户级 Skill 目录，例如 `$CODEX_HOME/skills/slothvault-mcp`（默认 `~/.codex/skills/slothvault-mcp`）或 Claude Code 的 `~/.claude/skills/slothvault-mcp`。先检查已有自定义内容，避免覆盖。

SlothTool 是可选的 Skill 安装更新与部署工具，不参与 MCP 连接、发现或 Tool 调用。它独立管理 Skill 和 Deployment；根安装命令管理界面插件，Skill 使用：

```bash
slothtool slothvault skill status --check --json
slothtool slothvault skill install
slothtool slothvault skill update
```

命令下载、校验独立 Skill 包并同步受管链接，无需独立 MCP 客户端。目录和 Skill 名称保持不变；自定义文件由用户处理。契约见 [PROTOCOL.md](../PROTOCOL.md)。

发布前运行 `python3 -m unittest discover -s integrations/scripts/tests` 和协议校验。拟发布 `skill-v1.2.0`；本轮仅本地代码、验证和归档，实际 Release 须绑定最终提交，不重复发布已有 Tag。

可选文章检查使用 Python 3.10+ 标准库：`python3 <skill目录>/scripts/check_article.py article.md --format json`。Python 不是原生 MCP 连接或普通 Skill 操作的要求；没有运行环境时使用教材清单并说明未执行自动检查。脚本不会联网、运行示例代码或修改文章。

文章流程以 MCP 5.0 的轻量列表为准：`content.article.list` 定位文章，`content.article.get` 读取正文。旧服务端若仍在列表中返回正文，也不要依赖该字段。安装更新命令、受管链接和桥主版本保持不变。
