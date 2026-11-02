# SlothVault 独立部署工具

部署程序按操作拆分为独立 Python 文件，通过 `menu.py` 提供中文数字菜单。仅依赖 Python 3.10+ 标准库及 Docker Compose v2。完整操作、参数与迁移说明见 [USAGE.md](USAGE.md)，该文件同时随 Deployment 归档交付。

```bash
python3 integrations/deployment/menu.py
python3 integrations/deployment/restart.py --root /data/slothvault
```

部署包继续使用独立 `deployment-vX.Y.Z` Release、`.tgz` 与 SHA-256 文件清单；SlothTool 仅管理 Skill。修改打包内容后暂存新增文件，执行 `npm run version:prepare`，核对 CHANGELOG 并运行 `node scripts/release-version.mjs --check-deployment`。发布流程见 [发布说明](../../docs/releasing.md)。

验证部署代码运行 `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s integrations/deployment/tests -p '*test.py'`；打包与解压后运行由集成打包测试覆盖。无需本地构建 Docker 镜像。
