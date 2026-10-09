# Vault → SlothTool 同步更新说明

先读 [ARCHITECTURE.md](./ARCHITECTURE.md)、[PROTOCOL.md](./PROTOCOL.md) 和机器契约。SlothTool 当前只管理 Skill/Deployment，本轮无需修改 SlothTool 代码和版本。

| Vault 变更 | Vault 版本与文件 | 消费方影响 |
| --- | --- | --- |
| Skill | frontmatter、module.json、CHANGELOG | skill install/update 同步独立包和受管链接 |
| Deployment 脚本/桥 | 元数据、CHANGELOG，必要时桥主版本 | 部署适配器和事件处理 |
| MCP 工具/资源/权限 | 应用版本、schema、注册表和测试 | 原生宿主重新发现 |
| 清单或归档路径 | 契约、JSON Schema、打包器 | 两包下载、校验和回退 |

## 2026-10-08 待发布基线

| 模块 | 版本 | 桥主版本 | 状态 |
| --- | --- | --- | --- |
| Skill | 1.1.0 | 1 | 拟发布 skill-v1.1.0，本轮仅代码和本地验证 |
| Deployment | 1.0.0 | 1 | 运行内容未变，不重发已有 Tag |

根 `slothtool install slothvault` / update 管理界面。`slothtool slothvault skill status --check --json`、skill install、skill update 直接获取独立 Skill，无 Client。原生配置由网站一次性生成，部署不依赖该连接。

## 发布与交接

1. 校验两模块版本、CHANGELOG 和协议，检查远端 Tag，避免重发。
2. 跑独立包回归、Deployment 目标测试和归档摘要自检；应用另按版本算法准备。
3. 有发布授权后，以包含最终代码和版本的提交发布对应 Release。Action 只验证、打包和发布，不回写历史。
4. 新 Skill 发布后，SlothTool skill install/update 可直接同步 1.1.0。目录仍为 slothvault-mcp，自定义内容保留并报告冲突。
5. 标准 SDK 测试、真实 Codex/Claude Code 连通和二进制保存分别记录，不能互相替代。

Client 和旧整包已退役，停止新 mcp-client-v*、toolkit-v* Release。/mcp/compatibility 移除，旧 Python Client 的 404 回退不是受支持接入。历史 Release 和本地数据保留，清理遵循架构文档的明确流程。
