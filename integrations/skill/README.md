# SlothVault Skill Package

此包只包含智能体 Skill 内容和 `module.json` 版本元数据。SlothVault 维护 Skill 的业务说明；SlothTool 负责探测智能体、安装与更新受管链接、冲突展示和版本检查。

手动安装时，将 `slothvault-mcp` 整个目录复制到目标智能体的用户级 Skill 目录，例如 `$CODEX_HOME/skills/slothvault-mcp`（默认 `~/.codex/skills/slothvault-mcp`）或 `$CLAUDE_CONFIG_DIR/skills/slothvault-mcp`（默认 `~/.claude/skills/slothvault-mcp`）。复制前查看目标是否已有自定义内容，不要直接覆盖。

通过 SlothTool 运行 `slothtool install slothvault` 安装三包，`slothtool sv` 打开 Skill 管理页；`slothtool update slothvault --module skill --check` 检查版本，去掉 `--check` 更新。SlothTool 只重定向经验证属于旧运行包的受管链接，自定义 Skill 由用户保留和处理。
