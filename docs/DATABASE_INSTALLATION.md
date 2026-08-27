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

本地 Docker 部署由三个完整且独立的 Compose 文件组成。不要合并文件、启用 profile 或复用不同模式的数据目录；每次只启动一种模式。

| 模式 | Compose 文件 | 服务 | 应用数据目录 | 数据库目录 |
| --- | --- | --- | --- | --- |
| SQLite | `docker-compose.yml` | `slothvault` | `./docker-data/sqlite/app` | 应用数据目录内的 `database/slothvault.db` |
| MySQL | `docker-compose.mysql.yml` | `slothvault`、`mysql` | `./docker-data/mysql/app` | `./docker-data/mysql/database` |
| PostgreSQL | `docker-compose.postgresql.yml` | `slothvault`、`postgresql` | `./docker-data/postgresql/app` | `./docker-data/postgresql/database` |

每个 `app` 目录都包含 `config/`、`database/` 和 `uploads/`。其中 `config/` 持久化加密连接配置及默认生成的主密钥，`uploads/` 持久化受控上传文件；MySQL 和 PostgreSQL 的真正数据库数据位于各自独立的 `database` 目录。

### SQLite

```bash
cp .env.docker.sqlite.example .env.docker.sqlite
docker compose --env-file .env.docker.sqlite up -d --build
```

SQLite Compose 只启动应用容器。它会使用固定路径 `/app/data/database/slothvault.db` 创建并初始化受管数据库；页面不能填写任意 SQLite 文件路径。

### MySQL 8.0

先复制示例并为应用账号和 MySQL root 账号设置不同的强密码：

```bash
cp .env.docker.mysql.example .env.docker.mysql
# 编辑 .env.docker.mysql：设置 MYSQL_PASSWORD 和 MYSQL_ROOT_PASSWORD
docker compose --env-file .env.docker.mysql -f docker-compose.mysql.yml up -d --build
docker compose --env-file .env.docker.mysql -f docker-compose.mysql.yml ps
```

Compose 使用 MySQL 8.0、InnoDB、`utf8mb4` 和独立本地数据目录。应用会等待 MySQL 健康检查，再使用同一组 `MYSQL_DATABASE`、`MYSQL_USER` 和 `MYSQL_PASSWORD` 自动保存加密连接配置并初始化空库；部署者不需要在网页重复填写连接信息。

### PostgreSQL 16

先复制示例并设置 PostgreSQL 应用账号密码：

```bash
cp .env.docker.postgresql.example .env.docker.postgresql
# 编辑 .env.docker.postgresql：设置 POSTGRES_PASSWORD
docker compose --env-file .env.docker.postgresql -f docker-compose.postgresql.yml up -d --build
docker compose --env-file .env.docker.postgresql -f docker-compose.postgresql.yml ps
```

Compose 使用 PostgreSQL 16 和独立本地数据目录。应用会等待 PostgreSQL 健康检查，再使用同一组 `POSTGRES_DB`、`POSTGRES_USER` 和 `POSTGRES_PASSWORD` 自动保存加密连接配置并初始化空库；部署者不需要在网页重复填写连接信息。

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

新的三模式 Compose 文件不会自动读取或移动旧 profile 方案的 `docker-data/config`、`docker-data/database`、`docker-data/mysql` 或 `docker-data/postgres`。先在升级本仓库或切换部署文件前，保留旧容器的 Compose 文件和运行环境，并完成备份；不要把旧目录挂载到新模式的 `app` 或 `database` 路径。

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
