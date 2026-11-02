# SlothVault 独立部署工具

需要 Python 3.10+、Docker Engine 和 Docker Compose v2；Python 仅使用标准库，不需要 SlothTool、Node.js 或 pip。脚本不会自动安装 Docker。

下载官方 Deployment Release 的 `slothvault-deployment-<版本>.tgz` 和 `slothvault-deployment-manifest.json`，核对清单中的归档 SHA-256 后解压。所有文件必须保留在同一目录结构中，不能只复制一个操作文件。

```bash
tar -xzf slothvault-deployment-<版本>.tgz
cd package
python3 menu.py --root /data/slothvault
```

源码入口为 `python3 integrations/deployment/menu.py`。从任意工作目录都能用脚本绝对路径运行；写入 `/data` 或访问 Docker 需要相应权限，可按需要使用 `sudo python3 /绝对路径/menu.py`。

| 文件 | 功能 |
| --- | --- |
| menu.py | 中文数字菜单，可修改部署目录，操作后返回菜单，0 退出 |
| install.py | 安装新实例，不覆盖已有 Compose 或持久化数据 |
| check_update.py | 检查实际应用版本、正式 Release 和更新日志 |
| update.py | 确认一个固定正式版本，拉取、更新并核验实际运行状态 |
| start.py | 启动整个实例，包括其数据库 |
| stop.py | 停止整个实例，保留持久化数据 |
| restart.py | 仅重启 slothvault 应用，数据库保持运行 |
| status.py | 查看实例、容器状态和可核实的实际应用版本 |

所有脚本支持 `--root`、`--help`、`--version`，默认目录 `/data/slothvault`。例如：

```bash
python3 install.py --root /data/slothvault --provider sqlite --port 3000
python3 status.py --root /data/slothvault
python3 check_update.py --root /data/slothvault
python3 update.py --root /data/slothvault
python3 restart.py --root /data/slothvault
```

安装支持 SQLite、MySQL、PostgreSQL，并保留 `--data-dir`、`--database-dir`、`--image`、`--port`、`--encryption-key`。数据库凭据通过安全输入收集；不应将密钥留在 shell 历史中。Compose 权限为 0600，持久化目录权限为 0700。首次 schema 初始化后，访问 `http://<服务器地址>:<端口>/install` 创建管理员。

更新只更新应用镜像，不重新生成既有端口、数据库或数据目录配置。先使用私有临时 Compose 拉取固定版本，再激活配置并重建应用；拉取失败时原配置保留。重建后的版本和健康检查失败会明确报错，不自动回退可能已迁移的数据。健康检查最多等待 120 秒；没有健康检查时明确显示。自定义镜像或无法识别的运行版本不会退回拉取 latest。

脚本自身通过下载新的独立 Deployment Release 更新，不会自行覆盖。应用版本和脚本包版本独立。旧 SlothTool 部署入口、`install.py --action ...` 和 `--bridge` 已移除，请改用对应操作文件。Nginx、HTTPS 与证书管理已移除，既有代理配置、证书和续期任务由管理员另行维护；脚本不会修改它们或改变现有回环端口绑定。

退出码：成功 0，操作失败 1，参数错误 2，Ctrl+C 中断 130。菜单空输入不触发安装；安装和更新均需确认。

## English

This standalone deployment package requires Python 3.10+, Docker Engine and Compose v2. It uses only the Python standard library. Extract the complete archive and run `python3 menu.py`; each operation above is also directly executable with `--root`, `--help` and `--version`. Start/stop operate on the full managed instance; restart targets only the application. Existing databases, data paths and port bindings are preserved. Deployment is no longer available through SlothTool, and Nginx/certificate management and the JSON-line bridge have been removed.
