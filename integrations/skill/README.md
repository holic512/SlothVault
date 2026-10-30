# SlothVault Skill Package

此包包含 Skill、按需参考资料、可选静态检查脚本和 module.json，当前版本 **1.2.6**，桥主版本 **1**。Skill 仅面向 Codex、Claude Code，使用当前宿主已连接并发现的 SlothVault 原生 MCP 工具；网站管理员 MCP Key 页提供接入配置。连接无需 SlothTool 或专用 Python 包。

手动安装时，将 `slothvault-mcp` 整个目录复制到用户级 Skill 目录，例如 `$CODEX_HOME/skills/slothvault-mcp`（默认 `~/.codex/skills/slothvault-mcp`）或 Claude Code 的 `~/.claude/skills/slothvault-mcp`。先检查已有自定义内容，避免覆盖。

SlothTool 是可选的 Skill 安装更新与部署工具，不参与 MCP 连接、发现或 Tool 调用。它独立管理 Skill 和 Deployment；根安装命令管理界面插件，Skill 使用：

```bash
slothtool slothvault skill status --check --json
slothtool slothvault skill install
slothtool slothvault skill update
```

命令下载、校验独立 Skill 包并同步受管链接，无需独立 MCP 客户端。目录和 Skill 名称保持不变；自定义文件由用户处理。契约见 [PROTOCOL.md](../PROTOCOL.md)。

修改 Skill 打包内容后，先暂存新增文件，再执行 `npm run version:prepare`；命令根据最新 `skill-v` 标签及已提交版本自动递增补丁版本，同步 `module.json`、入口元数据、README 和本版 CHANGELOG。同一批未提交修改重复准备不会再次递增；上一批已提交但尚未发布时，新一批内容修改仍会递增。README、CHANGELOG、tests 和缓存等未打包内容不单独触发递增。手动设置更高的版本会保留，低于最新发布版本会报错。自动生成的发布记录只列出改动文件，提交前应补充具体行为说明。

发布前运行 `python3 -m unittest discover -s integrations/scripts/tests`、协议校验和 `node scripts/release-version.mjs --check-skill`。CI 拒绝内容变化却未递增版本、版本回退或入口元数据不一致；正式 Release 使用 `skill-v1.2.6` 并绑定最终提交，不覆盖已有 Tag，也不回写 Git 历史。

Release 正文来自上一份已发布 Skill 版本以来的完整相关提交消息，保留提交正文与编号项；打包与校验信息位于 Actions Summary。Skill Release 不成为仓库 Latest。失败后在默认分支的发布入口填写原 commit SHA 或 Skill Tag，可补齐一致的草稿；已正式发布的附件与正文仅核验。详见 [发布流程](../../docs/releasing.md)。

可选文章检查使用 Python 3.10+ 标准库：`python3 <skill目录>/scripts/check_article.py article.md --format json`。Python 不是原生 MCP 连接或普通 Skill 操作的要求；没有运行环境时使用教材清单并说明未执行自动检查。脚本不会联网、运行示例代码或修改文章。

文章流程以 MCP 5.0 的轻量列表为准：`content.article.list` 定位文章，`content.article.get` 读取正文。旧服务端若仍在列表中返回正文，也不要依赖该字段。安装更新命令、受管链接和桥主版本保持不变。

## 当前项目文档

在项目目录启用此 Skill 后，可以直接说“为当前项目创建文档到 SlothVault”或“更新这个项目的文档”。默认只保存草稿；新版本完整复制上一版本再增量修订，同版本草稿复用，未变化不写入。源码基线采用当前检出，不自动切换到最新 Release。

项目文档需要服务端 MCP 5.1 的 `outline`、`get_many`、`apply_draft` 能力。缺少时会要求更新服务；旧文章和单篇接口保持兼容。专项工作流按需加载，普通文章不加载项目文档参考。

- `scripts/inspect_project.py`：只读检查版本、Commit、脏工作区及受影响文档候选，不 fetch 或 checkout。
- `scripts/check_project_docs.py`：检查整套文档的结构、标题、链接、重复段落、基线和集中更新日志；风格提示仅供人工判断。

新增管理元数据不进入用户教程或存证哈希。升级服务后再安装对应正式 Skill 包，不用未发布源码覆盖受管目录。
