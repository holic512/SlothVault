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

支持两种 Nginx：标准系统级 Nginx，以及显式指定的官方 Docker Hub `nginx` 容器。明确不支持宝塔 Nginx、`/www/server/nginx`、`/www/server/panel/vhost/nginx`、宝塔/面板镜像或其他第三方面板 Nginx。脚本不会接管非 SlothVault 生成的 `slothvault.conf`，不会删除、重建或自动发现 Docker 容器。

默认 `--nginx-mode auto` 只检测宿主机 `PATH` 中的系统级 Nginx；找不到时不会扫描 Docker。系统级模式仅管理 `/etc/nginx/sites-available` + `sites-enabled` 或 `/etc/nginx/conf.d` 中的受管文件，执行宿主机 `nginx -t`、`nginx -T` 后以 systemd 或 `nginx -s reload` 重载。实际可执行路径或 Nginx 配置来源包含宝塔目录时会被拒绝。

Docker 模式必须提供容器名，并且镜像必须是 `nginx`、`library/nginx` 或 `docker.io/library/nginx`（可带 tag/digest）。脚本通过 `docker inspect` 检查容器存在、运行、镜像、网络与 mount，只接受宿主机 bind mount 到 `/etc/nginx/conf.d`（写入 `<Source>/slothvault.conf`）或 `/etc/nginx`（写入 `<Source>/conf.d/slothvault.conf`）。没有该 mount 时会停止，不会修改容器内部临时文件、named volume 或任意用户参数指定的目录。

Docker Nginx 与受管 SlothVault 必须共享同一非 host Docker 网络，且应用容器在该网络有 `slothvault` 别名。满足后上游固定为 `slothvault:3000`，不会错误使用容器内的 `127.0.0.1`。配置命令如下：

```bash
sudo python3 deploy/install.py \
  --action nginx \
  --nginx-mode docker \
  --nginx-container slothvault-nginx
```

容器至少需要这些挂载；配置目录的宿主机端应可写，容器端可以只读：

```yaml
services:
  nginx:
    image: nginx:alpine
    container_name: slothvault-nginx
    volumes:
      - /opt/slothvault/nginx/conf.d:/etc/nginx/conf.d:ro
      - /data/slothvault/acme-challenge:/var/www/slothvault-acme:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
```

Docker 模式写入后只执行 `docker exec <容器> nginx -t`、`nginx -T`、`nginx -s reload`，不会调用宿主机 `nginx` 或 `systemctl`。验证、最终加载检查或重载失败时，脚本恢复之前的受管文件（或移除本轮新建文件）并再次在容器内校验和重载。

“申请或更新 Let's Encrypt HTTPS 证书”仅支持普通 DNS 域名，可输入多个域名作为同一证书的 SAN；第一个域名为主域名。该操作需要：

- 使用 `sudo` 运行；
- 域名的 A/AAAA 已指向此服务器；
- 公网防火墙已允许 TCP `80` 和 `443`；
- 用户确认 Let’s Encrypt 服务条款和联系邮箱。

脚本使用 HTTP-01 Webroot 验证，不使用会自动改写 Nginx 配置的 `certbot --nginx`。成功后，HTTP `80` 只保留 `/.well-known/acme-challenge/`，其他请求以 `301` 跳转 HTTPS；HTTPS `443` 才转发至 SlothVault。不会默认启用 HSTS。Docker HTTPS 必须同时将宿主机 `/data/slothvault/acme-challenge` 与完整 `/etc/letsencrypt` bind mount 到容器明确路径；脚本会从 inspect 推导容器路径，缺少任何一个均在签发前停止。

Docker HTTPS 使用相同的显式容器参数：

```bash
sudo python3 deploy/install.py \
  --action https \
  --nginx-mode docker \
  --nginx-container slothvault-nginx
```

若没有 Certbot，Debian/Ubuntu 通过 `apt-get`、Fedora/RHEL 通过 `dnf` 安装；仓库不可用或其他发行版时，脚本会停止并要求管理员先完成安装，不会添加第三方仓库或改用 Snap。证书续约成功后系统级模式重载 Nginx，Docker 模式仅重载已验证的指定容器；已启用的 Certbot systemd timer 会被复用，否则脚本创建自己的 systemd timer，缺少 systemd 时回退为 cron。

运行证书菜单后会执行一次 `certbot renew --dry-run --run-deploy-hooks`。实际签发仍取决于真实 DNS、网络和 Let’s Encrypt 校验结果。

Docker 排查命令：`docker inspect slothvault-nginx`、`docker exec slothvault-nginx nginx -t`、`docker exec slothvault-nginx nginx -T`、`docker network inspect <SlothVault 网络>`。脚本不会自动连接 Docker 网络；请先使 Nginx 容器与对应的 `slothvault-<provider>_default` 网络共享。
