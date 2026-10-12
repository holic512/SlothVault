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

支持本机安装和 Docker 容器两种 Nginx。默认 `--nginx-mode auto` 从服务、master 进程、实际启动参数和 Docker 容器中发现候选，以 `nginx -V/-t/-T` 确认配置来源。Docker 不以镜像名称做准入判断，只更新能够映射到宿主机 bind mount 的生效文件；不会修改 named volume、容器临时文件、启动或重建容器。状态检查会显示停止容器和无法管理的原因。

`--nginx-config` 指定实际主配置（Docker 模式使用容器内路径），`--nginx-site` 和 `--nginx-server-name` 限定配置文件与 server 块。从应用端口、容器别名／地址和 upstream 组识别 SlothVault，多个候选时要求选择。支持一个配置文件包含多个站点，以及站点文件名并非 slothvault.conf 的部署。

```bash
python3 install.py --action nginx-discover --root /data/slothvault
python3 install.py --action nginx-status --root /data/slothvault
sudo python3 install.py --action nginx-update --root /data/slothvault \
  --nginx-mode docker --nginx-container proxy \
  --nginx-site /etc/nginx/conf.d/vault.conf --nginx-server-name vault.example.com
```

`nginx-update` 展示具体指令后确认一次，保留站点监听、HTTPS、证书、鉴权、代理地址和其他自定义设置。备份上传无限请求体并关闭请求缓冲，备份下载关闭响应缓冲／临时落盘，相关空闲超时至少 3600 秒；普通 multipart 接口至少 25 MiB，委托上传至少 100 MiB，已有更高／无限上限不降低。应用的业务和完整性校验继续生效。

更新只在选定代理 location 内增加可继承原设置的传输策略。遇到无法安全隔离的共享 location、rewrite、复杂正则、URI 替换或自定义 Range 处理，停止并给出原因。操作在 `.nginx-backups/` 保存带权限信息的原文件，预览后配置或 include 变化时停止；校验／加载／重载失败恢复原文件并报告回滚结果。目录挂载使用原子替换，单文件 bind mount 保留 inode。已符合要求时不重载。

`nginx` 基础配置优先更新已识别的站点；没有匹配站点时在实际 include 的目录新建按域名和部署根目录区分的独立配置。新站点操作保留 Compose 和其他站点。成功后 `.nginx-target.json` 保存不含凭据的目标；后续重新发现并核对，不盲用旧路径。SlothTool 3.2.0 在部署页的 Nginx 子菜单展示发现／选择、状态、基础配置、更新、HTTPS 和证书功能。

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

Docker 模式在相同的 -c/-p 上下文中执行 `docker exec <容器> nginx -t`、`nginx -T`、`nginx -s reload`，不会调用宿主机 `nginx` 或 `systemctl`。验证、最终加载检查或重载失败时，脚本恢复之前的站点文件（或移除本轮新建文件）并再次在容器内校验和重载。

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

### English Nginx contract

Deployment 1.1.1 discovers host processes/services and Docker Nginx, loads the actual configuration with its original `-c/-p` context, maps bind mounts and identifies the application proxy site. Site-scoped transfer updates preserve HTTPS, authentication and unrelated servers, review once, back up and roll back failed writes. Existing finite limits are only raised when below 25 MiB for multipart or 100 MiB for commission uploads; backup transfers have no proxy body limit. In-place writes preserve single-file bind-mount inodes. Complex routing fails explicitly instead of guessing. The Deployment CI runs a real isolated Nginx transfer fixture.
