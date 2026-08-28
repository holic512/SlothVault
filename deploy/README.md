# SlothVault Linux 部署包

这个目录是 SlothVault GitHub Release 中 `slothvault-deploy.zip` 的全部内容。它不依赖源码目录、Node.js 或第三方 Python 包；只需在 Linux 主机上解压后运行入口脚本。

## 快速安装

前置条件：Python 3.8+、Docker Engine、Docker Compose v2。脚本不会自动安装 Docker。

```bash
curl -fL https://github.com/holic512/SlothVault/releases/latest/download/slothvault-deploy.zip -o slothvault-deploy.zip
python3 -m zipfile -e slothvault-deploy.zip .
sudo python3 deploy/install.py
```

首次安装选择 SQLite、MySQL 或 PostgreSQL 后，脚本会创建私有持久化目录和 `/data/slothvault/compose.yml`，再拉取并启动发布镜像。默认应用数据目录为 `/data/slothvault/data`；MySQL、PostgreSQL 数据分别位于 `/data/slothvault/mysql`、`/data/slothvault/postgresql`。Compose 文件权限为 `0600`，持久化数据目录权限为 `0700`。

安装菜单完全使用中文，提供安装、更新、启动、停止、状态、Nginx HTTP 反代、Let’s Encrypt HTTPS 与立即续约操作。以后更新只需再次运行同一条 Python 脚本并选择“拉取最新镜像并更新现有实例”。

## Nginx 与 HTTPS

脚本会检测宿主机 `PATH` 中是否存在 `nginx`，但不会自动安装 Nginx。选择反向代理后，它只会管理标准 Nginx 目录中的 `slothvault.conf`：Debian/Ubuntu 的 `sites-available` + `sites-enabled`，或发行版的 `/etc/nginx/conf.d`。非本脚本生成的同名文件不会被覆盖。

启用反代后，应用端口会绑定到 `127.0.0.1`，外部请求通过 Nginx 转发。写入后脚本执行 `nginx -t` 和 `nginx -T`，再重载或在确认后启动 Nginx。

“申请或更新 Let's Encrypt HTTPS 证书”仅支持普通 DNS 域名，可输入多个域名作为同一证书的 SAN；第一个域名为主域名。该操作需要：

- 使用 `sudo` 运行；
- 域名的 A/AAAA 已指向此服务器；
- 公网防火墙已允许 TCP `80` 和 `443`；
- 用户确认 Let’s Encrypt 服务条款和联系邮箱。

脚本使用 HTTP-01 Webroot 验证，不使用会自动改写 Nginx 配置的 `certbot --nginx`。成功后，HTTP `80` 只保留 `/.well-known/acme-challenge/`，其他请求以 `301` 跳转 HTTPS；HTTPS `443` 才转发至 SlothVault。不会默认启用 HSTS。

若没有 Certbot，Debian/Ubuntu 通过 `apt-get`、Fedora/RHEL 通过 `dnf` 安装；仓库不可用或其他发行版时，脚本会停止并要求管理员先完成安装，不会添加第三方仓库或改用 Snap。证书续约成功后会自动重载 Nginx；已启用的 Certbot systemd timer 会被复用，否则脚本创建自己的 systemd timer，缺少 systemd 时回退为 cron。

运行证书菜单后会执行一次 `certbot renew --dry-run --run-deploy-hooks`。实际签发仍取决于真实 DNS、网络和 Let’s Encrypt 校验结果。
