# Vault → SlothTool 同步更新说明

SlothTool 2.12.0 / SlothVault 插件 3.3.0 只管理 Skill；部署工具完全在 Vault 独立运行。协议见 [PROTOCOL.md](PROTOCOL.md)，职责见 [ARCHITECTURE.md](ARCHITECTURE.md)。

| Vault 变更 | Vault 文件与发布 | 消费方影响 |
| --- | --- | --- |
| Skill | frontmatter、module.json、CHANGELOG，skill-v 标签 | SlothTool Skill install/update 同步内容和链接 |
| Deployment | module.json、CHANGELOG、独立脚本、USAGE.md，deployment-v 标签 | 管理员下载完整包，使用 menu.py 或对应操作脚本 |
| MCP 工具／资源／权限 | 应用版本、schema、注册表与测试 | 原生宿主重新发现 |
| 清单与归档 | 契约、Schema、打包器及测试 | Skill 保持原契约；Deployment 不再声明桥协议 |

部署菜单和七个操作均支持独立运行。原 SlothTool 部署入口只显示迁移提示；Nginx、HTTPS 和证书管理已移除，旧机器配置不会自动清除。Skill 与原生 MCP 接入保持独立，原生凭据不进入 SlothTool。

发布前暂存新增内容并按现有 version:prepare 准备版本，核对 CHANGELOG、标签与 SHA-256 清单。运行部署功能、独立打包及发布工具目标测试；归档解压后从其他目录验证全部入口。Action 只验证和发布，不回写 Git 历史。源码完成及本地检查不能声称服务器或已发布包已经更新。
