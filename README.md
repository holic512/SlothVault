<div align="center">
  <img src="./public/logo.png" alt="SlothVault logo" width="104" />

# SlothVault

面向独立写作、项目发布与版本存证的自托管内容系统。

管理员分别管理站点文章与项目版本内容；访客可直接阅读；注册用户拥有资料、安全、合同与积分工作区。已发布项目版本可选择写入 Solana Memo 交易，形成可公开核验的版本凭证。

</div>

## 项目概述

SlothVault 基于 Next.js 16 App Router、React 19 和 Prisma 7，支持 SQLite、MySQL 与 PostgreSQL，并通过网页安装器完成首次配置。

## 界面预览

> 截图于 2026-08-17 的本地实例，均已压缩为 WebP。资源按日期归档在 [`docs/assets/screenshots/2026-08-17/`](./docs/assets/screenshots/2026-08-17/)；示例数据不代表生产环境默认内容。

<p align="center">
  <img src="./docs/assets/screenshots/2026-08-17/public-home.webp" alt="SlothVault 公开首页空态" width="100%" />
</p>

<table>
  <tr>
    <td width="50%"><img src="./docs/assets/screenshots/2026-08-17/account-overview.webp" alt="用户账户概览工作区" /></td>
    <td width="50%"><img src="./docs/assets/screenshots/2026-08-17/admin-dashboard.webp" alt="管理后台仪表盘" /></td>
  </tr>
  <tr>
    <td align="center">账户概览：资料、安全与积分入口</td>
    <td align="center">管理后台：内容、用户与系统状态概览</td>
  </tr>
  <tr>
    <td width="50%"><img src="./docs/assets/screenshots/2026-08-17/admin-user-management.webp" alt="管理后台用户管理页面" /></td>
    <td width="50%"><img src="./docs/assets/screenshots/2026-08-17/admin-system-settings.webp" alt="管理后台系统设置页面" /></td>
  </tr>
  <tr>
    <td align="center">用户管理：创建、编辑、密码重置与积分调整</td>
    <td align="center">系统设置：品牌与 Solana 网络配置</td>
  </tr>
</table>

## 核心功能

| 范围 | 已实现能力 |
| --- | --- |
| 内容发布 | 独立 Markdown 文章，以及项目、版本、分类、项目文档、首页内容与受控文件管理。 |
| 阅读体验 | 无需钱包即可阅读已发布文章和公开项目；文章详情、项目版本文档与存证凭证可直接分享。 |
| 用户系统 | 用户名/邮箱密码登录、可选 Solana 钱包签名登录、账户资料、密码、钱包绑定与积分工作区。 |
| 用户权益 | 不可变积分流水、管理员积分调整、批量生成卡密与一次性兑换。 |
| 管理后台 | 内容、文件、用户、卡密、备份、系统设置及版本交易存证的集中管理。 |
| 版本存证 | 为已发布版本生成 manifest 哈希；可在 Solana Mainnet 或 Devnet 写入 Memo，并提供公开凭证页。 |
| 数据库与部署 | 网页安装器支持 SQLite、MySQL 8.0+ 与 PostgreSQL 14+；提供 Docker Compose 部署。 |

## 安装与快速开始

### 本地开发

前置条件：Node.js `>=24.18.1`、npm `>=11.16.0`。使用 SQLite 本地开发无需 Docker。

```bash
npm ci
APP_DATA_PATH=./data UPLOAD_STORAGE_PATH=./data/uploads npm run dev
```

访问 [http://localhost:3000/install](http://localhost:3000/install)，在安装器中选择数据库、完成空库检查、初始化表结构并创建首位管理员。安装状态由系统维护，数据库连接不会通过 `DATABASE_URL` 或旧 `DB_*` 环境变量绕过安装器。

### Docker Compose

正式 Linux 部署使用 Release 附件中的 `slothvault-deploy.zip`。它解压出独立的纯标准库部署包 `deploy/`，不需要源码目录、Node.js 或额外 Python 包：交互选择 SQLite、MySQL 或 PostgreSQL 后，会在部署根目录生成私有的 `/data/slothvault/compose.yml`，创建所选模式的持久化目录，拉取发布镜像并启动服务。首次 schema 初始化由应用自动完成；随后访问应用的 `/install` 页面创建首位管理员。

前置条件：Linux 已安装 Docker Engine、Docker Compose v2 与 Python 3.8+。部署包不会尝试根据发行版自动安装 Docker。默认 `/data` 目录和 Nginx/证书配置需要管理员权限，建议从首次安装开始使用 `sudo`，后续 Docker 命令也使用同一权限级别。

```bash
curl -fL https://github.com/holic512/SlothVault/releases/latest/download/slothvault-deploy.zip -o slothvault-deploy.zip
python3 -m zipfile -e slothvault-deploy.zip .
sudo python3 deploy/install.py
```

脚本的默认路径如下；输入时可按需改为其他绝对路径。生成的 `compose.yml` 包含数据库凭据（若选择 MySQL/PostgreSQL），因此脚本会将其权限设为 `0600`；所有持久化目录为 `0700`。

| 模式 | 应用数据目录（映射至 `/app/data`） | 数据库数据目录 |
| --- | --- | --- |
| SQLite | `/data/slothvault/data` | `/data/slothvault/data/database/slothvault.db` |
| MySQL 8.0 | `/data/slothvault/data` | `/data/slothvault/mysql` |
| PostgreSQL 16 | `/data/slothvault/data` | `/data/slothvault/postgresql` |

MySQL 与 PostgreSQL Compose 配置会等待数据库健康检查成功，再启动应用。应用目录保存加密数据库配置、上传文件和仅 SQLite 使用的数据库文件；服务器数据库始终存放在独立目录，不能与应用数据目录交叠。Docker 本地模式固定使用 Compose 内部网络的非 TLS 连接。

### Nginx 与 HTTPS

部署包支持两种、且仅支持两种 Nginx：标准目录中的系统级 Nginx，以及用户显式指定的官方 Docker Hub `nginx` 容器。明确不支持宝塔 Nginx、`/www/server/nginx`、`/www/server/panel/vhost/nginx`、宝塔/面板镜像和其他第三方面板托管的 Nginx；脚本不会猜测这些目录，也不会接管非 SlothVault 生成的 `slothvault.conf`。

默认的 `--nginx-mode auto` 保持兼容：只检测宿主机 `PATH` 中的系统级 `nginx`，不会扫描、发现或接管任意 Docker 容器。系统级模式仅管理 `/etc/nginx/sites-available` + `/etc/nginx/sites-enabled` 或 `/etc/nginx/conf.d` 下的受管站点文件；写入后执行宿主机 `nginx -t`、`nginx -T`，再用 `systemctl reload nginx` 或 `nginx -s reload` 重载。它会拒绝 Nginx 可执行文件或实际配置来源指向宝塔目录的情况。

Docker 模式必须显式提供容器名。脚本只接受 `nginx`、`library/nginx` 或 `docker.io/library/nginx`（可带标签或 digest）的官方镜像，只从 `docker inspect` 确认的宿主机 bind mount 推导配置位置：优先 `<宿主机目录> -> /etc/nginx/conf.d`，其次 `<宿主机目录> -> /etc/nginx` 再使用其 `conf.d/slothvault.conf`。它不写容器临时文件，不接受 named volume 或任意 `--nginx-config-dir`，也不会执行 `docker rm`、重建容器、`docker compose down`、连接网络或接管已有第三方容器。

Docker Nginx 必须与 SlothVault 应用容器共享 Compose 网络，且应用在共享网络中带有 `slothvault` 别名；通过预检后配置固定使用 `proxy_pass http://slothvault:3000;`。这避免把 Docker 容器自己的 `127.0.0.1` 误作宿主机。先启动 SlothVault，再使用以下命令配置 HTTP 反代：

```bash
sudo python3 deploy/install.py \
  --action nginx \
  --nginx-mode docker \
  --nginx-container slothvault-nginx
```

一个 SQLite 实例的典型官方 Nginx 容器挂载如下；MySQL/PostgreSQL 时将 `slothvault-sqlite_default` 换为相应的 Compose 网络。`/opt/slothvault/nginx/conf.d` 必须对宿主机脚本可写，容器可只读挂载它。

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

菜单中的“申请或更新 Let's Encrypt HTTPS 证书”使用宿主机 Certbot 的 `certonly --webroot` HTTP-01 验证，不会使用会自动改写站点文件的 `certbot --nginx`。输入一个或多个普通 DNS 域名（首个为主域名）、联系邮箱并确认服务条款后，`80` 提供 ACME 验证，签发成功后其余 HTTP 请求 `301` 跳转至 `443`；不会默认开启 HSTS。Docker HTTPS 还要求上例中 `/data/slothvault/acme-challenge` 和完整 `/etc/letsencrypt` 都已 bind mount 到容器。脚本从 inspect 使用容器内路径渲染 ACME 与证书配置，因而不会把宿主机证书路径错误写入 Docker Nginx。

```bash
sudo python3 deploy/install.py \
  --action https \
  --nginx-mode docker \
  --nginx-container slothvault-nginx
```

证书功能需要域名 A/AAAA 已指向服务器、TCP `80` 和 `443` 已在防火墙/安全组放行，并以 `sudo python3 deploy/install.py` 运行。缺少 Certbot 时，脚本仅会在 Debian/Ubuntu 使用 `apt-get`、在 Fedora/RHEL 使用 `dnf` 安装；不支持的发行版或缺少软件源时会停止并提示管理员处理，不会添加第三方仓库或改用 Snap。续约成功后系统级模式重载系统 Nginx，Docker 模式只执行经验证容器的 `docker exec <容器> nginx -s reload`；timer/cron 与首次 `certbot renew --dry-run --run-deploy-hooks` 保持一致。

Docker 模式排查请优先执行 `docker inspect slothvault-nginx`、`docker exec slothvault-nginx nginx -t`、`docker exec slothvault-nginx nginx -T` 和 `docker network inspect slothvault-sqlite_default`。如果缺少配置、ACME、证书挂载或共同网络，脚本会在写入前停止；配置校验或重载失败时会恢复原有受管文件，并再次在容器内校验和重载恢复后的配置。若系统启用了 SELinux 且 Nginx 出现 `502`，还需要由系统管理员按发行版策略允许 Nginx 连接上游服务。

未来更新不需要重新生成配置或迁移数据目录。发布部署包中的脚本会显示自身版本、运行中应用版本、GitHub 最新正式 Release，以及本次跨版本升级包含的提交日志。先检查，再按提示确认更新：

```bash
sudo python3 deploy/install.py --action check-update
sudo python3 deploy/install.py --action update
```

应用更新仅拉取并重启 `compose.yml` 中已声明的镜像，持久化数据保持不变；如果脚本本身落后，输出会提示下载最新部署包，脚本不会自行覆盖。仍可在确认需要绕过版本检查时使用以下 Docker Compose 命令：

```bash
docker compose -f /data/slothvault/compose.yml pull
docker compose -f /data/slothvault/compose.yml up -d
```

仓库仍保留三份 `docker-compose*.yml` 和示例环境文件，供从源码构建或本地开发使用；生产服务器推荐使用 Release 中的 `slothvault-deploy.zip`。远程 MySQL/PostgreSQL 或自定义 CA 的部署，继续使用网页安装器手工配置，详见[数据库安装与迁移指南](./docs/DATABASE_INSTALLATION.md)。

## 使用模型

| 身份 | 可执行操作 |
| --- | --- |
| 访客 | 阅读已发布的独立文章与公开项目，访问版本存证凭证。 |
| 普通用户 | 访客能力，以及资料维护、密码与钱包设置、积分查询和卡密兑换。 |
| 管理员 | 普通用户能力，以及内容发布、用户/积分/卡密/文件/备份管理和版本存证。 |

普通密码与钱包签名登录都会签发同一种 HttpOnly 数据库 Session。钱包流程仅验证地址所有权：浏览器签署一次性挑战消息，服务端验证 Ed25519 签名；不会发送钱包交易，也不会保存私钥。

## 版本交易存证

发布内容和区块链存证彼此独立：版本可先公开，后续再由管理员钱包进行存证。每条凭证绑定一个 `ProjectVersion.releaseHash`，使用 Solana 官方 Memo Program，不表示 NFT 所有权、版权归属或可转移资产。

- Mainnet 凭证用于正式存证，Devnet 用于测试；同一版本在每个网络最多保留一条最终凭证。
- 办理前会重新计算 manifest、展示网络与费用信息；提交后保留交易签名，并可继续对账最终状态。
- 公开凭证路由为 `/evidence/<transactionSignature>`；来源版本被隐藏后，正文、版本名和 manifest 不再公开。

## 架构

```mermaid
flowchart LR
    Browser["浏览器"] --> Public["文章 / 项目阅读"]
    Browser --> Account["账户与积分"]
    Browser --> Admin["管理后台"]

    Public --> Routes["Next.js App Router + Route Handlers"]
    Account --> Routes
    Admin --> Routes

    Routes --> Services["服务层"]
    Services --> Prisma["按安装配置选择的 Prisma Client"]
    Prisma --> SQLite[(SQLite)]
    Prisma --> MySQL[(MySQL)]
    Prisma --> PostgreSQL[(PostgreSQL)]

    Services --> Uploads[(受控上传目录)]
    Services --> Memory["进程内 TTL 挑战与限流"]
    Services --> Solana["Solana RPC / Memo 存证"]

    Installer["网页安装器"] --> EncryptedConfig["加密数据库配置"]
    Installer --> Prisma
```

账户、文章、积分、卡密和存证索引均以 SQL 数据库为权威来源。短期内存仅用于登录/注册限流与钱包一次性挑战，不承担余额或持久化业务状态。

## 配置与数据安全

| 配置 | 用途 |
| --- | --- |
| `APP_DATA_PATH` | 应用配置和本地数据库目录；本地默认 `<cwd>/data`，容器默认 `/app/data`。 |
| `UPLOAD_STORAGE_PATH` | 受控上传目录；本地默认 `<cwd>/data/uploads`，容器默认 `/app/data/uploads`。 |
| `ENCRYPTION_KEY` | 配置加密主密钥；未提供时系统会在配置目录生成持久化密钥。 |
| `SOLANA_RPC_URL` | Mainnet 主 RPC 的环境回退值；建议在后台敏感设置中维护实际地址。 |
| `SOLANA_MAINNET_RPC_FALLBACK` | Mainnet 备用 RPC。 |
| `SOLANA_DEVNET_RPC_URL` | Devnet 主 RPC 的环境回退值。 |
| `SOLANA_DEVNET_RPC_FALLBACK` | Devnet 备用 RPC。 |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | 浏览器 Wallet Adapter 使用的公共集群地址。 |

浏览器钱包通过 Solana Wallet Standard 自动发现，不需要为每个扩展单独引入 SDK。安装且启用 Solana 账户的兼容钱包（例如 OKX Wallet）会出现在钱包选择器中；当前签名、登录和存证协议均为 Solana，尚不包含 EVM/OKB Chain 地址或交易支持。

上传文件不进入 `public/`。数据库 JSON 与上传 ZIP 可独立导出、严格校验并恢复；备份包含账户、密码哈希、内容、积分、卡密哈希和存证索引，应按敏感数据管理。

## 项目结构

```text
src/
├── app/                       # 页面、布局与 Route Handlers
├── components/                # 公开、账户、管理端 React 组件
├── i18n/                      # 语言请求解析与本地化元数据
├── server/
│   ├── auth/                  # Session、角色与密码
│   ├── database/              # 多数据库、安装与迁移
│   └── services/              # 内容、用户、积分、备份与存证业务
└── types/                     # 浏览器安全 DTO

prisma/providers/              # SQLite / MySQL / PostgreSQL schema 与迁移
messages/                      # 中英文消息目录
docs/assets/screenshots/        # README 截图，按日期归档
data/                           # 本地配置、数据库与上传数据（已忽略）
```

## 开发与验证

```bash
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run lint
npm run lint:styles
npm test
npm run build
```

默认测试不会替代真实 Solana 钱包写入或跨数据库恢复验证。涉及真实 SQL 服务、RPC 或钱包的集成验证，应在隔离环境中显式执行。

## 文档

- [数据库安装与迁移指南](./docs/DATABASE_INSTALLATION.md)
- [发布 manifest 规范](./docs/RELEASE_MANIFEST_V1.md)

## 许可证

SlothVault 自身源码采用 [MIT License](./LICENSE) 授权。第三方依赖按其各自许可证执行。
