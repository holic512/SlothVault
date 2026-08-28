# 数据库安装与迁移指南

SlothVault 的发布包同时包含 SQLite、MySQL 和 PostgreSQL 支持，但一个运行实例只使用首次安装时选定的一种主数据库。登录挑战与限流使用单实例进程内存；本地 Docker Compose 模式会自动完成数据库连接、空库校验和首次迁移，其他部署继续由 `/install` 完成，后续已提交迁移在服务启动时自动部署。

## 支持范围

| Provider | 支持版本 | 适用部署 | 主要限制 |
| --- | --- | --- | --- |
| SQLite | 应用内置 driver | 单机、个人或轻量部署 | 单 SlothVault 实例、本地磁盘，不支持网络共享文件系统 |
| MySQL | 8.0+、InnoDB | 独立数据库服务 | 数据库必须预先创建且没有任何用户表 |
| PostgreSQL | 14+ | 独立数据库服务 | 数据库必须预先创建且没有任何用户表 |

三种 provider 使用相同逻辑模型和独立、已提交的迁移集合。安装完成后不能在线切换 provider；需要切换时使用逻辑备份恢复流程。

## Docker 部署

发布版推荐使用 GitHub Release 附件中的 `slothvault-deploy.zip`。解压出的 `deploy/` 目录只依赖 Python 3.8+ 标准库，运行在宿主机而不是应用容器中；它会选择 provider、生成唯一的 `/data/slothvault/compose.yml`、创建私有持久化目录，再调用已安装的 Docker Compose v2 拉取并启动发布镜像。部署包不安装 Docker Engine，也不覆盖已有的 Compose 文件或非空数据目录。

```bash
curl -fL https://github.com/holic512/SlothVault/releases/latest/download/slothvault-deploy.zip -o slothvault-deploy.zip
python3 -m zipfile -e slothvault-deploy.zip .
sudo python3 deploy/install.py
```

如 `/data` 需要管理员权限，请从一开始使用 `sudo python3 deploy/install.py`，并在后续 `docker compose` 维护命令中使用相同权限。首次启动后访问实际服务地址的 `/install` 页面创建首位管理员。

| 模式 | 服务 | 生成的 Compose 文件 | 应用数据目录 | 数据库目录 |
| --- | --- | --- | --- | --- |
| SQLite | `slothvault` | `/data/slothvault/compose.yml` | `/data/slothvault/data` | 应用数据目录内的 `database/slothvault.db` |
| MySQL | `slothvault`、`mysql` | `/data/slothvault/compose.yml` | `/data/slothvault/data` | `/data/slothvault/mysql` |
| PostgreSQL | `slothvault`、`postgresql` | `/data/slothvault/compose.yml` | `/data/slothvault/data` | `/data/slothvault/postgresql` |

所有路径均可在脚本交互时替换为其他绝对路径。应用数据目录包含 `config/`、`database/`、`uploads/`；`config/` 持久化加密连接配置及默认生成的主密钥，`uploads/` 持久化受控上传文件。MySQL/PostgreSQL 的真实数据库数据必须位于独立目录，不能放入或覆盖应用数据目录。脚本将 `compose.yml` 设为 `0600`，将新建数据目录设为 `0700`，因为 MySQL/PostgreSQL 的 Compose 环境中含有数据库密码。

SQLite 只启动应用容器，并使用固定路径 `/app/data/database/slothvault.db` 创建并初始化受管数据库；页面不能填写任意 SQLite 文件路径。MySQL Compose 使用 MySQL 8.0、InnoDB、`utf8mb4`；PostgreSQL Compose 使用 PostgreSQL 16。两种服务器数据库都会先通过健康检查，应用才会使用同一组初始化参数自动保存加密连接配置并初始化空库。

### 已有 Nginx 的反向代理

部署包支持标准系统级 Nginx 与显式指定的官方 Docker Hub `nginx` 容器。明确不支持宝塔 Nginx、`/www/server/nginx`、`/www/server/panel/vhost/nginx`、宝塔/面板镜像、其他第三方面板托管的 Nginx，也不会自动改造或接管已有第三方 Nginx。脚本不会安装 Nginx、覆盖非 SlothVault 生成的同名站点文件、删除容器、重建容器或执行 `docker compose down`。

默认 `--nginx-mode auto` 只从宿主机 `PATH` 检测系统级 Nginx，找不到时不会扫描 Docker 容器。系统级模式只使用 `/etc/nginx/sites-available` + `/etc/nginx/sites-enabled` 或 `/etc/nginx/conf.d`；检测到实际二进制或 Nginx 配置来源属于宝塔目录时会直接以中文错误拒绝。已有实例可再次运行 `sudo python3 deploy/install.py`，选择“配置或更新 Nginx 反向代理”。

选择后，脚本会要求输入一个站点域名或 IPv4 地址及 Nginx HTTP 监听端口（默认 `80`），并执行以下受控流程：

1. 仅在 `/etc/nginx/sites-available` + `/etc/nginx/sites-enabled` 或 `/etc/nginx/conf.d` 中生成 `slothvault.conf`；找不到这些标准目录时停止，不猜测或创建未知 Nginx 配置结构。
2. 生成 `proxy_pass http://127.0.0.1:<SlothVault 端口>`、`proxy_http_version 1.1`、`Host`、`X-Real-IP`、`X-Forwarded-For`、`X-Forwarded-Proto` 和 `X-Forwarded-Host` 请求头。
3. 使用 `nginx -t` 验证语法和文件引用，再用 `nginx -T` 确认生成的站点确实被主配置加载；任一步失败都会恢复本轮写入的站点配置或启用链接。
4. 在 Nginx 已运行时重载服务；未运行时经用户再次确认后启动服务。
5. 将 SlothVault 容器的宿主机端口绑定改为 `127.0.0.1:<端口>:3000`，然后重新创建容器，以阻止直接绕过 Nginx 的公网访问。

该操作需要写入 `/etc/nginx`，请使用 `sudo python3 deploy/install.py`。HTTP 反向代理可以使用自定义监听端口；若要申请证书，请使用独立的“申请或更新 Let's Encrypt HTTPS 证书”菜单，它固定使用标准 `80` 和 `443` 端口。

### 官方 Docker Nginx

Docker 模式要求用户明确指定容器名，且只接受镜像引用 `nginx`、`library/nginx` 或 `docker.io/library/nginx`（允许 tag/digest）。不提供 `--nginx-config-dir`：脚本只从 `docker inspect` 的 bind mount 推导安全写入目标，优先处理 `宿主机目录 -> /etc/nginx/conf.d` 并写入 `<Source>/slothvault.conf`，其次处理 `宿主机目录 -> /etc/nginx` 并写入 `<Source>/conf.d/slothvault.conf`。named volume、没有配置 bind mount、软链接、路径穿越、非普通 `slothvault.conf` 都会被拒绝。

Nginx 容器必须先启动，并与受管 SlothVault 服务共享一个非 host Docker 网络。脚本调用 `docker compose -f /data/slothvault/compose.yml ps -q slothvault` 取得应用容器后检查共同网络和 `slothvault` 别名；满足后配置固定生成 `proxy_pass http://slothvault:3000;`。Docker Nginx 中的 `127.0.0.1` 是容器自身，因此不会被作为回退上游；没有可靠共同网络时脚本停止，并提示先把 Nginx 容器连接到对应的 `slothvault-<provider>_default` 网络。

```bash
sudo python3 deploy/install.py \
  --action nginx \
  --nginx-mode docker \
  --nginx-container slothvault-nginx
```

一个使用 SQLite 受管网络的官方容器示例：

```yaml
services:
  nginx:
    image: nginx:alpine
    container_name: slothvault-nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /opt/slothvault/nginx/conf.d:/etc/nginx/conf.d:ro
      - /data/slothvault/acme-challenge:/var/www/slothvault-acme:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    networks:
      - slothvault-sqlite_default

networks:
  slothvault-sqlite_default:
    external: true
```

配置目录在宿主机必须存在且可写；容器内可以使用只读挂载。脚本写入后只会运行 `docker exec slothvault-nginx nginx -t`、`docker exec slothvault-nginx nginx -T`、`docker exec slothvault-nginx nginx -s reload`。它不会调用宿主机 `nginx -t/-T` 或 `systemctl reload nginx` 作为 Docker 模式最终验证/重载。校验或重载失败时，脚本恢复原受管配置或删除本轮新文件，再次在容器内执行语法检查并重载恢复后的配置。

### Let's Encrypt HTTPS 与自动续约

HTTPS 菜单采用 Certbot `certonly --webroot` HTTP-01 验证，部署包自己的 Nginx 配置是唯一配置来源，不使用会自动修改站点文件的 `certbot --nginx`。输入普通 DNS 域名（可输入多个，首个为主域名和证书目录名）、联系邮箱并确认 Let’s Encrypt 服务条款后，受管 Nginx 配置将按以下方式切换：

1. 临时在 `80` 端口从 `/data/slothvault/acme-challenge` 提供 `/.well-known/acme-challenge/`，其余请求仍反代至应用；系统级模式使用 `127.0.0.1:<端口>`，Docker 模式使用已验证的 `slothvault:3000`。
2. Certbot 成功签发后，HTTP 仅保留挑战路径，其他请求以 `301` 跳转至 HTTPS；Nginx 在 `443` 使用 `/etc/letsencrypt/live/<主域名>/fullchain.pem` 和 `privkey.pem` 反代 SlothVault。Docker 模式使用 inspect 推导出的容器内证书路径。
3. 在证书签发前，脚本会将 Compose 应用端口绑定到 `127.0.0.1`，由临时 HTTP 代理保持服务可达；这会阻止直接绕过 Nginx 的公网访问。若签发前的步骤失败，会恢复本轮受管 Nginx 和 Compose 改动；HTTPS 激活失败时会保留已签发证书并恢复可用的临时 HTTP 代理。

只支持明确的普通 DNS 域名；不支持 IP、通配符、DNS-01 和自定义 CA。请在运行前确认各域名 A/AAAA 已指向此服务器，并在云安全组/防火墙中开放 TCP `80` 与 `443`。脚本会显示本机 DNS 解析结果，但不会通过公网 IP 自动比对替用户判断 DNS 指向。不会默认开启 HSTS。

未检测到 Certbot 时，脚本只会在 Debian/Ubuntu 使用 `apt-get update` + `apt-get install certbot`，或在 Fedora/RHEL 使用 `dnf install -y certbot`。其他发行版、缺少包管理器或 RHEL 软件源没有 Certbot 时会停止并要求管理员处理；不会自动添加第三方仓库或改用 Snap。

成功后，脚本写入 Certbot deploy hook，使续约成功后重载 Nginx。若已有活动的 Certbot systemd timer 则复用；否则创建 `slothvault-certbot-renew.timer`，每天两次并使用随机延迟运行续约；没有 systemd 时生成 cron 后备任务。首次配置最后执行 `certbot renew --dry-run --run-deploy-hooks`。菜单“查看证书状态或立即尝试续约”会显示本实例主证书文件状态，并可执行一次实际的 `certbot renew` 检查；Certbot 会按其原生行为检查宿主机所有受管理证书。

Docker HTTPS 在申请前还必须确认两个 bind mount：宿主机 `/data/slothvault/acme-challenge` 映射到容器的明确 ACME Webroot，以及完整宿主机 `/etc/letsencrypt` 映射到容器明确证书根目录（不能只挂载 `live`，因为证书文件会链接到 `archive`）。缺少任一挂载时会在签发前停止。Docker 模式的 Certbot deploy hook 仅执行已验证容器的 `docker exec <容器> nginx -s reload`，不调用 `systemctl`。

```bash
sudo python3 deploy/install.py \
  --action https \
  --nginx-mode docker \
  --nginx-container slothvault-nginx
```

常见 Docker 排查命令：`docker inspect slothvault-nginx`、`docker exec slothvault-nginx nginx -t`、`docker exec slothvault-nginx nginx -T`、`docker network inspect slothvault-sqlite_default`。脚本不会自动修改这些挂载或连接网络。

若使用 SELinux 且 Nginx 出现 `502 Bad Gateway`，部署者还需根据发行版安全策略允许 Nginx 连接本机上游服务。

安装脚本提供“更新、启动、停止、状态、配置或更新 Nginx 反向代理、申请或更新 Let's Encrypt HTTPS 证书、查看证书状态或立即尝试续约”操作。更新只执行镜像拉取与 `up -d`，不会覆盖 Compose 配置或移动/删除持久化目录；也可以直接运行：

```bash
docker compose -f /data/slothvault/compose.yml pull
docker compose -f /data/slothvault/compose.yml up -d
docker compose -f /data/slothvault/compose.yml ps
```

仓库内的 `docker-compose.yml`、`docker-compose.mysql.yml`、`docker-compose.postgresql.yml` 及 `.env.docker.*.example` 仍用于源码构建和本地开发。不要将该源码模式的相对 `docker-data/` 目录与 Release 安装脚本的 `/data/slothvault/` 部署混用。

### 自动引导与首次管理员

三份 Compose 文件都将 `SLOTHVAULT_AUTO_BOOTSTRAP=1` 传给应用。启动时应用只接受这组受控、命名空间隔离的 `SLOTHVAULT_BOOTSTRAP_*` 变量：它会校验 provider 与连接参数、拒绝非空目标库、以现有安装锁执行固定 provider 的迁移，并把配置加密写入 `app/config/database.enc`。迁移成功后状态为 `SCHEMA_READY`，访问 `http://localhost:3000/install` 时只会显示首位管理员创建步骤。

已存在的配置必须与 Compose 推导出的 provider、主机、端口、数据库、账号和密码完全一致。配置不匹配、无法解密或目标库不为空时，应用会失败退出；不会覆盖配置、清空表或删除文件。`CONFIGURING` 状态会在下一次启动时使用相同连接恢复迁移，`SCHEMA_READY` 和 `INSTALLED` 则只执行正常的已提交迁移升级。运行时不会记录数据库密码或完整连接串，且启动参数在读取后从 Node.js 进程环境移除。

Compose 内的 MySQL/PostgreSQL 连接固定为非 TLS，因为通信仅经过该 Compose 项目的内部网络。需要远程数据库、TLS 或自定义 CA 时，不要设置 `SLOTHVAULT_AUTO_BOOTSTRAP`，改用下方的网页安装器流程。

## 短期内存状态

本地 `npm run dev` 直接启动 Next.js，不依赖外部缓存服务。钱包登录的一次性挑战和注册、登录、卡密兑换等接口的固定窗口限流保存在当前 Node.js 进程中，并按 TTL 惰性清理。

短期状态在进程重启后清空，不保存用户余额、积分流水、卡密权威状态或 Session 记录。内存容量达到安全上限时，新挑战或新限流身份会失败关闭。该实现面向 SQLite 单实例和轻量部署；若未来运行多个应用副本，需要重新引入独立的共享短期状态服务。

## 安装状态与接口

| 状态 | 含义 | 允许操作 |
| --- | --- | --- |
| `UNCONFIGURED` | 没有本地数据库配置 | 测试连接、初始化 |
| `CONFIGURING` | 已保存 pending 配置，迁移尚未完成 | 重试初始化；未创建 schema 时可 reset |
| `SCHEMA_READY` | 初始迁移完成，尚无管理员 | 创建唯一首个管理员 |
| `INSTALLED` | 安装完成 | 正常访问应用；`/install` 重定向到登录页 |
| `MAINTENANCE` | 配置无法读取或已安装数据库不可用 | 修复卷、主密钥或数据库；不会开放重装 |

安装接口：

- `GET /api/install/status`：返回状态、provider 和脱敏的主机/数据库摘要。
- `POST /api/install/test-connection`：只读检查连接、TLS 与空库状态。
- `POST /api/install/initialize`：重新检查空库，保存加密配置并执行对应初始迁移。
- `POST /api/install/admin`：事务内创建唯一首个管理员并完成安装。
- `POST /api/install/reset`：仅在 schema 尚未成功创建时清除 pending 本地配置，不删除数据库对象。

第一位访问者可以安装系统。文件锁、进程锁和数据库唯一约束用于阻止并发安装，但公网部署仍应先通过反向代理、防火墙或临时网络规则限制 `/install` 的访问范围，直到管理员创建完成。

## 空库与权限要求

网页安装器连接 MySQL/PostgreSQL 时，数据库必须由数据库管理员预先创建，并授予应用用户建立表、索引、外键以及读写业务数据所需权限；网页安装器不会创建数据库或数据库用户。独立 Docker Compose 的 MySQL/PostgreSQL 模式例外：官方数据库镜像根据同一份 Compose 环境变量创建本地数据库和应用账号。

空库检查会枚举目标数据库中的用户表。只要发现任何用户表，初始化就会拒绝且不会执行 DDL；不能把旧版 SlothVault 数据库直接交给新安装器，也不能用 `prisma db push` 合并结构。

SQLite 安装同样只接受不存在或没有用户表的受控数据库文件。若安装失败，不要手工删除可能已创建的数据库对象；保留日志并确认安装状态后再处理。

## TLS 与 CA

MySQL/PostgreSQL 表单支持 TLS 开关和可选 CA PEM：

- 启用 TLS 时始终验证服务端证书，不提供“接受任意证书”的模式。
- 托管数据库使用公共 CA 时，按服务商说明决定是否需要粘贴 CA。
- 私有 CA 或自签发链必须粘贴完整 PEM；不要把客户端私钥或数据库密码粘贴到 CA 字段。
- 主机名必须与证书匹配。不要用 IP 地址替代证书中的 DNS 名称，除非证书明确包含该 IP。

CA 内容随数据库配置一起加密，不会通过安装状态接口返回。迁移子进程只通过环境传递临时连接串；CA 临时文件使用私有权限并在操作结束后删除。

## 配置与密钥

运行数据根目录由 `APP_DATA_PATH` 控制，Docker 固定为 `/app/data`：

```text
/app/data/
├── config/
│   ├── database.enc
│   ├── installation.state # 配置丢失检测标记，不含数据库凭据
│   └── master.key         # 未设置 ENCRYPTION_KEY 时生成
├── database/
│   └── slothvault.db     # 仅 SQLite
└── uploads/
```

`database.enc` 使用 AES-256-GCM 加密并以原子重命名写入；`installation.state` 用于区分真正首次部署与配置文件意外丢失。配置目录权限为 `0700`，配置、标记和密钥文件权限为 `0600`。数据库密码不会出现在状态接口或正常日志中。

未启用 Compose 自动引导时，数据库连接只能通过安装页保存。以下旧变量不受支持，也不能绕过安装状态：

- `DATABASE_URL`
- `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD`
- `DB_WAIT_TIMEOUT`

本地 Compose 模式会将经过校验的 `SLOTHVAULT_BOOTSTRAP_*` 参数临时注入应用服务，以加密写入同一模式的 `database.enc` 并完成首次 schema 初始化。它们不是远程数据库配置接口，应用不会回显密码，且读取后会从 Node.js 进程环境移除。`POSTGRES_*` 与 `MYSQL_*` 仍是对应官方数据库镜像的初始化参数。

如果不提供 `ENCRYPTION_KEY`，请持久化并备份整个 `config` 目录。若通过环境提供密钥，则必须在所有重启中保持完全一致，并与配置卷一起备份。不能通过清空配置目录来修复一个已安装系统；这样会失去数据库绑定并可能破坏加密的 Solana 数据。

## SQLite 运行约束

- 只运行一个 SlothVault 进程或容器；第二实例应被实例锁拒绝。
- 使用本地块存储；不支持 NFS、SMB、分布式卷或多主机共享。
- 同时备份 `slothvault.db` 及 SQLite 运行时相关文件时，应先停止应用，或优先使用系统逻辑备份。
- 保持 `database` 目录可写并持久化；只挂载单个数据库文件会遗漏辅助文件和原子替换需求。

需要高可用、多副本或远程数据库时请选择 MySQL/PostgreSQL。

## 旧 profile 部署与 provider 切换

Release 安装脚本与仓库内的三种源码 Compose 模板都不会自动读取或移动旧 profile 方案的 `docker-data/config`、`docker-data/database`、`docker-data/mysql` 或 `docker-data/postgres`。先在升级本仓库或切换部署方式前，保留旧容器的 Compose 文件和运行环境，并完成备份；不要把旧目录挂载到新的应用或数据库数据路径。

切换旧部署或 provider 的安全步骤：

1. 保持旧实例运行，在旧管理后台导出数据库 JSON 和上传 ZIP。
2. 在旧实例导出 2.0–2.5 JSON；新版本会忽略并统计其中的 Tree/cNFT 与废弃 Filebase 配置，2.6 之前的备份按空文章集合导入。
3. 备份旧 `ENCRYPTION_KEY`，它仍用于数据库配置加密。
4. 使用目标模式的全新本地目录启动新 Compose；自动引导完成后，在 `/install` 创建新的管理员。
5. 登录新实例，导入数据库 JSON，再导入上传 ZIP。
6. 抽查首页、独立文章、项目版本文档、文件、系统设置和版本交易存证记录。
7. 验证完成前保留旧数据库、旧上传目录及两份导出文件。

升级迁移会不可逆删除本地 `solana_compressed_nft`、`solana_merkle_tree` 与 Tree 专用运行锁；链上既有资产不会被销毁，但站内不再索引。执行升级前必须备份数据库。当前 `2.6.0` 逻辑备份迁移独立文章、项目内容、用户、管理员、密码哈希、积分、卡密和其他业务数据，但不迁移 Session。

## 维护与恢复

| 现象 | 处理 |
| --- | --- |
| `/install` 报目标非空 | 换用真正空库；不要授权安装器清表 |
| 配置无法解密 | 恢复匹配的 `config` 卷和 `ENCRYPTION_KEY`；不要重新安装覆盖 |
| Compose 启动时报配置不匹配 | 恢复与当前 `app/config` 配对的同一模式变量；不要改挂载目录或删除 `database.enc` |
| 已安装数据库不可达 | 修复网络、DNS、TLS、数据库服务或账号权限，然后重试请求 |
| SQLite 第二实例启动失败 | 保留一个实例；确认没有另一个进程持有同一 `database` 卷 |
| 初始化中断 | 保留现场并重试状态检查；只有仍为 `CONFIGURING` 且 schema 未创建时才使用 reset |

容器日志用于判断启动与请求状态，但不应输出数据库密码、完整连接串、Cookie、Token 或私钥。自动迁移只执行仓库已提交的 provider migrations；升级前仍应导出数据库 JSON、上传 ZIP 并备份配置/主密钥。
