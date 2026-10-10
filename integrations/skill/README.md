# SlothVault Skill Package

此包包含 Skill、按需参考资料、可选静态检查脚本和 module.json，当前版本 **1.2.3**，桥主版本 **1**。Skill 仅面向 Codex、Claude Code，使用当前宿主已连接并发现的 SlothVault 原生 MCP 工具；网站管理员 MCP Key 页提供接入配置。连接无需 SlothTool 或专用 Python 包。

手动安装时，将 `slothvault-mcp` 整个目录复制到用户级 Skill 目录，例如 `$CODEX_HOME/skills/slothvault-mcp`（默认 `~/.codex/skills/slothvault-mcp`）或 Claude Code 的 `~/.claude/skills/slothvault-mcp`。先检查已有自定义内容，避免覆盖。

SlothTool 是可选的 Skill 安装更新与部署工具，不参与 MCP 连接、发现或 Tool 调用。它独立管理 Skill 和 Deployment；根安装命令管理界面插件，Skill 使用：

```bash
slothtool slothvault skill status --check --json
slothtool slothvault skill install
slothtool slothvault skill update
```

命令下载、校验独立 Skill 包并同步受管链接，无需独立 MCP 客户端。目录和 Skill 名称保持不变；自定义文件由用户处理。契约见 [PROTOCOL.md](../PROTOCOL.md)。

修改 Skill 打包内容后，先暂存新增文件，再执行 `npm run version:prepare`；命令根据最新 `skill-v` 标签及已提交版本自动递增补丁版本，同步 `module.json`、入口元数据、README 和本版 CHANGELOG。同一批未提交修改重复准备不会再次递增；上一批已提交但尚未发布时，新一批内容修改仍会递增。README、CHANGELOG、tests 和缓存等未打包内容不单独触发递增。手动设置更高的版本会保留，低于最新发布版本会报错。自动生成的发布记录只列出改动文件，提交前应补充具体行为说明。

发布前运行 `python3 -m unittest discover -s integrations/scripts/tests`、协议校验和 `node scripts/release-version.mjs --check-skill`。CI 拒绝内容变化却未递增版本、版本回退或入口元数据不一致；正式 Release 使用 `skill-v1.2.3` 并绑定最终提交，不覆盖已有 Tag，也不回写 Git 历史。

可选文章检查使用 Python 3.10+ 标准库：`python3 <skill目录>/scripts/check_article.py article.md --format json`。Python 不是原生 MCP 连接或普通 Skill 操作的要求；没有运行环境时使用教材清单并说明未执行自动检查。脚本不会联网、运行示例代码或修改文章。

文章流程以 MCP 5.0 的轻量列表为准：`content.article.list` 定位文章，`content.article.get` 读取正文。旧服务端若仍在列表中返回正文，也不要依赖该字段。安装更新命令、受管链接和桥主版本保持不变。
