# SlothVault Linux 部署程序

这个目录作为 SlothVault Deployment Package 独立发布，也可直接从源码运行 `python3 integrations/deployment/install.py`。它包含完整的纯标准库 Python 部署程序，不依赖 SlothVault 源码目录之外的第三方 Python 包。SlothTool 将它安装到独立版本目录；在 `slothtool sv` 的“概览”页查看实例，在“部署”页管理脚本包及应用部署，或通过 `slothtool sv deploy` 启动 CLI。

## 快速安装

前置条件：Python 3.10+、Docker Engine、Docker Compose v2。脚本不会自动安装 Docker。

应用镜像同时支持 `linux/amd64` 和 `linux/arm64`，默认由 Docker 选择主机对应架构。Deployment 脚本包的版本独立于应用镜像，现有桥主版本保持 1。

修改打包内容后先暂存新增文件，再执行 `npm run version:prepare`，自动准备 Deployment 补丁版本和 CHANGELOG；README、CHANGELOG、tests 与缓存更新不单独触发递增。发布前运行 `node scripts/release-version.mjs --check-deployment`。CI 拒绝版本回退及内容变化却未递增版本。

Deployment Release 正文使用上一份已发布部署包以来的完整相关提交消息，构建与校验信息放入 Actions Summary；不成为仓库 Latest。原提交或 Tag 的失败恢复方式见 [发布流程](../../docs/releasing.md)。

```bash
npm install -g @holic512/slothtool
slothtool install slothvault
sudo env HOME="$HOME" "$(command -v slothtool)" slothvault deploy
```

也可以将上面命令末尾的 `deploy` 去掉，进入全屏管理页后切换到“部署”，选择“安装新实例”。

首次安装选择 SQLite、MySQL 或 PostgreSQL 后，脚本会创建私有持久化目录和 `/data/slothvault/compose.yml`，再拉取并启动发布镜像。默认应用数据目录为 `/data/slothvault/data`；MySQL、PostgreSQL 数据分别位于 `/data/slothvault/mysql`、`/data/slothvault/postgresql`。Compose 文件权限为 `0600`，持久化数据目录权限为 `0700`。

安装菜单完全使用中文，提供安装、检查更新、更新、启动、停止、状态、Nginx HTTP 反代、Let’s Encrypt HTTPS 与立即续约操作。检查更新比较运行中的应用镜像和 SlothVault GitHub 正式 Release，显示最新正式版本及当前版本之后每个正式 Release 的提交日志。确认更新后，部署程序会把受管 Compose 中的官方镜像固定到最新正式版本的 tag，一次完成跨版本更新；不会拉取可变的 `latest` tag：

```bash
sudo env HOME="$HOME" "$(command -v slothtool)" slothvault deploy --action check-update
sudo env HOME="$HOME" "$(command -v slothtool)" slothvault deploy --action update
```

部署程序不会自行下载或覆盖自身。`--version` 显示 Deployment Package 版本；应用版本可在部署状态中单独查看。仅更新部署脚本包运行 `slothtool slothvault deploy package update`（兼容入口 `slothtool update slothvault --module deployment`）；`slothtool update slothvault` 只更新管理界面。Skill、Deployment、界面插件和应用分别检查与更新。

## 1.1.0 应用更新与进度

“更新应用”先读取实际运行版本和正式 Release，预览当前版本、固定目标镜像、部署目录及重启影响，再确认一次。桥模式按 y 继续、n/Esc 取消；普通 CLI 保留原有 y/n 输入和退出码。后端不在确认后切换到新出现的 Release。

先用同目录的私有临时 Compose 拉取目标应用镜像，成功后激活正式配置并重建 slothvault 服务。重建前失败恢复原配置；重建后失败输出实际快照，不自动回退可能已迁移的数据。其他服务及持久化数据保留。

桥模式持续处理 stdout/stderr，只输出允许的进度字段和分类错误。Compose 支持时使用 JSON 进度，否则 plain 或阶段回退。镜像层的计量与百分比仅表示该层下载／解压，不表示整体更新进度。无可靠总量不提供百分比；长命令每 5 秒心跳表示存活，不代表下载进展。

重建后直接检查实际容器、运行镜像、嵌入的发布标识及健康，不重新联网查询 GitHub。必须正在运行且达到目标；有健康检查时最多等待 120 秒、每 2 秒检查；无健康检查明确标注。未通过版本或健康核验以失败结束。最终 snapshot 在取消、失败和完成时都发送；快照读取失败单独记录。管理界面缺少运行证据时显示“版本未核验”，不能把配置中的目标当成实际版本。

### English update contract

Deployment 1.1.0 reviews one immutable official Release and asks once before execution. It pulls through private staged Compose configuration, activates after pull, recreates the application, and verifies the running container image, embedded Release identity and health locally. It never needs another GitHub query to declare success. Health polling runs every two seconds for up to 120 seconds; absent checks are explicitly reported. Failure before recreation restores configuration; later failure reports actual state without automatic rollback.

Bridge major 1 gains optional typed prompts, measured layer progress, separate five-second heartbeats, runtime-image snapshots and explicit outcomes. JSON progress falls back to plain output or phase events. Only reliable per-layer totals produce percentages; raw commands, environment variables and stderr are not forwarded. Final snapshots are sent after cancellation and failure as well as success. The UI package, Deployment, Skill and application versions are independent; `slothtool update slothvault` updates only the UI.

## Nginx 与 HTTPS

支持两种 Nginx：标准系统级 Nginx，以及显式指定的官方 Docker Hub `nginx` 容器。明确不支持宝塔 Nginx、`/www/server/nginx`、`/www/server/panel/vhost/nginx`、宝塔/面板镜像或其他第三方面板 Nginx。脚本不会接管非 SlothVault 生成的 `slothvault.conf`，不会删除、重建或自动发现 Docker 容器。

默认 `--nginx-mode auto` 只检测宿主机 `PATH` 中的系统级 Nginx；找不到时不会扫描 Docker。系统级模式仅管理 `/etc/nginx/sites-available` + `sites-enabled` 或 `/etc/nginx/conf.d` 中的受管文件，执行宿主机 `nginx -t`、`nginx -T` 后以 systemd 或 `nginx -s reload` 重载。实际可执行路径或 Nginx 配置来源包含宝塔目录时会被拒绝。

Docker 模式必须提供容器名，并且镜像必须是 `nginx`、`library/nginx` 或 `docker.io/library/nginx`（可带 tag/digest）。脚本通过 `docker inspect` 检查容器存在、运行、镜像、网络与 mount，只接受宿主机 bind mount 到 `/etc/nginx/conf.d`（写入 `<Source>/slothvault.conf`）或 `/etc/nginx`（写入 `<Source>/conf.d/slothvault.conf`）。没有该 mount 时会停止，不会修改容器内部临时文件、named volume 或任意用户参数指定的目录。

Docker Nginx 与受管 SlothVault 必须共享同一非 host Docker 网络，且应用容器在该网络有 `slothvault` 别名。满足后上游固定为 `slothvault:3000`，不会错误使用容器内的 `127.0.0.1`。配置命令如下：

```bash
sudo env HOME="$HOME" "$(command -v slothtool)" slothvault deploy \
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

- 使用保留安装用户 SlothTool 数据目录的管理员调用方式运行；
- 域名的 A/AAAA 已指向此服务器；
- 公网防火墙已允许 TCP `80` 和 `443`；
- 用户确认 Let’s Encrypt 服务条款和联系邮箱。

脚本使用 HTTP-01 Webroot 验证，不使用会自动改写 Nginx 配置的 `certbot --nginx`。成功后，HTTP `80` 只保留 `/.well-known/acme-challenge/`，其他请求以 `301` 跳转 HTTPS；HTTPS `443` 才转发至 SlothVault。不会默认启用 HSTS。Docker HTTPS 必须同时将宿主机 `/data/slothvault/acme-challenge` 与完整 `/etc/letsencrypt` bind mount 到容器明确路径；脚本会从 inspect 推导容器路径，缺少任何一个均在签发前停止。

Docker HTTPS 使用相同的显式容器参数：

```bash
sudo env HOME="$HOME" "$(command -v slothtool)" slothvault deploy \
  --action https \
  --nginx-mode docker \
  --nginx-container slothvault-nginx
```

若没有 Certbot，Debian/Ubuntu 通过 `apt-get`、Fedora/RHEL 通过 `dnf` 安装；仓库不可用或其他发行版时，脚本会停止并要求管理员先完成安装，不会添加第三方仓库或改用 Snap。证书续约成功后系统级模式重载 Nginx，Docker 模式仅重载已验证的指定容器；已启用的 Certbot systemd timer 会被复用，否则脚本创建自己的 systemd timer，缺少 systemd 时回退为 cron。

运行证书菜单后会执行一次 `certbot renew --dry-run --run-deploy-hooks`。实际签发仍取决于真实 DNS、网络和 Let’s Encrypt 校验结果。

Docker 排查命令：`docker inspect slothvault-nginx`、`docker exec slothvault-nginx nginx -t`、`docker exec slothvault-nginx nginx -T`、`docker network inspect <SlothVault 网络>`。脚本不会自动连接 Docker 网络；请先使 Nginx 容器与对应的 `slothvault-<provider>_default` 网络共享。
