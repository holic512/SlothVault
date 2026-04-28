<div align="center">

# 🦥 SlothVault

**基于区块链的下一代文档管理系统**

[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://hub.docker.com/r/holic512/slothvault)
[![Nuxt](https://img.shields.io/badge/Nuxt-4-00DC82?logo=nuxt.js&logoColor=white)](https://nuxt.com)
[![Solana](https://img.shields.io/badge/Solana-Integrated-14F195?logo=solana&logoColor=white)](https://solana.com)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README_EN.md) | 简体中文

</div>

---

## 📖 项目简介

**SlothVault** 是一个创新的文档管理系统，将传统的内容管理与 Solana 区块链技术深度融合。通过 **压缩 NFT (cNFT)** 技术，实现了低成本、高效率的文档版权保护和访问权限管理。

### 🎯 核心特性

#### 📚 强大的文档管理
- **多项目管理** - 支持创建和管理多个独立项目
- **版本控制** - 每个项目支持多个版本，灵活管理文档迭代
- **分类系统** - 树形分类结构，支持无限层级
- **Markdown 编辑** - 内置强大的 Markdown 编辑器，支持实时预览
- **自定义主题** - 动态主题系统，支持深色/浅色模式和多种配色方案

#### 🔐 区块链权限管理
- **cNFT 访问控制** - 基于 Solana 压缩 NFT 的文档访问权限
- **低成本铸造** - 利用 Merkle Tree 压缩技术，铸造成本低至 0.0001 SOL
- **自动验证** - 智能合约自动验证用户持有的 cNFT，无需人工审核
- **链上+链下混合验证** - 本地数据库缓存 + DAS API 链上验证，性能与安全兼顾

#### 🎨 现代化用户体验
- **响应式设计** - 完美适配桌面、平板和移动设备
- **国际化支持** - 内置中英文双语，易于扩展更多语言
- **SSR 渲染** - 前台页面服务端渲染，SEO 友好
- **实时搜索** - 快速搜索文档、分类和项目

#### 🛠️ 完善的管理后台
- **项目管理** - 创建、编辑、删除项目，配置访问权限
- **文档编辑** - 富文本 Markdown 编辑器，支持图片上传
- **文件管理** - 统一的文件管理系统，支持 IPFS 存储
- **Solana 管理** - 可视化管理 Merkle Tree 和 cNFT
- **系统配置** - 灵活的系统配置，支持多网络切换
- **备份恢复** - 一键备份和恢复所有数据

---

## 🚀 快速开始

### Docker 部署（推荐）

SlothVault 镜像现在只包含应用本身，数据库使用独立 PostgreSQL。你可以选择 Docker Compose 一次启动完整环境，或者用 `docker run` / `docker create` 连接已有 PostgreSQL。

#### 方式一：Docker Compose（推荐）

Compose 会创建两个容器：`postgres` 数据库和 `slothvault` 应用，并把持久化数据映射到本地目录。

```bash
# 克隆仓库
git clone https://github.com/yourusername/slothvault.git
cd slothvault

# 创建并编辑 Docker 环境变量
cp .env.docker.example .env.docker
# 修改 .env.docker 中的 DB_PASSWORD 和 ENCRYPTION_KEY

# 启动服务
docker compose --env-file .env.docker up -d
```

访问 `http://localhost:3000` 即可使用：

- 管理后台：`http://localhost:3000/admin`
- 首次访问会引导创建管理员账号
- PostgreSQL 数据默认保存在本地 `./docker-data/postgres`
- Nuxt 上传文件默认保存在容器内 `/app/public/uploads`，并映射到本地 `./docker-data/uploads`

`ENCRYPTION_KEY` 必须长期保存。更换它会导致已加密的 Solana 私钥无法解密。

#### 方式二：连接已有 PostgreSQL

```bash
mkdir -p docker-data/uploads

docker run -d \
  --name slothvault \
  -p 3000:3000 \
  -e ENCRYPTION_KEY="your-stable-random-secret" \
  -e DB_HOST="your-postgres-host" \
  -e DB_PORT="5432" \
  -e DB_NAME="slothvault" \
  -e DB_USER="slothvault" \
  -e DB_PASSWORD="your-database-password" \
  -v "$(pwd)/docker-data/uploads:/app/public/uploads" \
  holic512/slothvault:latest
```

如果你的数据库密码包含 URL 特殊字符，建议直接传入完整连接串：

```bash
mkdir -p docker-data/uploads

docker run -d \
  --name slothvault \
  -p 3000:3000 \
  -e ENCRYPTION_KEY="your-stable-random-secret" \
  -e DATABASE_URL="postgresql://user:password@host:5432/slothvault" \
  -v "$(pwd)/docker-data/uploads:/app/public/uploads" \
  holic512/slothvault:latest
```

也可以先创建再启动容器：

```bash
mkdir -p docker-data/uploads

docker create \
  --name slothvault \
  -p 3000:3000 \
  -e ENCRYPTION_KEY="your-stable-random-secret" \
  -e DB_HOST="your-postgres-host" \
  -e DB_PORT="5432" \
  -e DB_NAME="slothvault" \
  -e DB_USER="slothvault" \
  -e DB_PASSWORD="your-database-password" \
  -v "$(pwd)/docker-data/uploads:/app/public/uploads" \
  holic512/slothvault:latest

docker start slothvault
```

**Docker 环境变量：**

- `ENCRYPTION_KEY`: 必填，稳定保存的加密密钥
- `DATABASE_URL`: 可选，完整 PostgreSQL 连接串，优先级最高
- `DB_HOST`: 未设置 `DATABASE_URL` 时必填，数据库地址
- `DB_PORT`: 可选，默认 `5432`
- `DB_NAME`: 可选，默认 `slothvault`
- `DB_USER`: 可选，默认 `slothvault`
- `DB_PASSWORD`: 未设置 `DATABASE_URL` 时必填，数据库密码
- `DB_WAIT_TIMEOUT`: 可选，等待数据库就绪的秒数，默认 `60`
- `POSTGRES_DATA_DIR`: Compose 使用，本地 PostgreSQL 数据目录，默认 `./docker-data/postgres`
- `UPLOADS_DIR`: Compose 使用，本地上传文件目录，默认 `./docker-data/uploads`

---

## 💡 使用场景

### 📖 技术文档管理
- 企业内部技术文档库
- 开源项目文档站点
- API 文档和开发指南

### 🎓 在线课程平台
- 付费课程内容管理
- 基于 cNFT 的课程访问权限
- 学员证书 NFT 发放

### 📰 付费内容订阅
- 会员专属文章
- 研究报告和白皮书
- 付费电子书和教程

### 🏢 企业知识库
- 内部培训资料
- 产品文档和手册
- 团队协作文档

---

## 🏗️ 技术架构

### 核心技术栈

```
前端框架：Nuxt 4 + Vue 3 + TypeScript
UI 组件：Element Plus
状态管理：Pinia
数据库：PostgreSQL + Prisma ORM
区块链：Solana + SPL Account Compression
存储：Filebase (IPFS)
国际化：@nuxtjs/i18n
```

### 系统架构

```
┌─────────────────────────────────────────────────────┐
│                   用户界面层                          │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │  前台展示页   │  │  管理后台    │                 │
│  │  (SSR)       │  │  (CSR)       │                 │
│  └──────────────┘  └──────────────┘                 │
└─────────────────────────────────────────────────────┘
                        │
┌─────────────────────────────────────────────────────┐
│                   应用服务层                          │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │  Nuxt Server │  │  API Routes  │                 │
│  └──────────────┘  └──────────────┘                 │
└─────────────────────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
┌───────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐
│  PostgreSQL  │ │   Solana   │ │  Filebase  │
│   数据库     │ │   区块链   │ │   IPFS     │
└──────────────┘ └────────────┘ └────────────┘
```

### 数据库设计

采用多 Schema 架构，逻辑清晰，易于维护：

- **auth** - 用户认证和会话管理
- **collections** - 项目、版本、分类管理
- **docs** - 文档内容存储
- **public** - 文件、配置、区块链数据

---

## 🔐 区块链集成

### Solana cNFT 技术

SlothVault 使用 Solana 的 **压缩 NFT (cNFT)** 技术实现文档访问权限管理：

#### 什么是 cNFT？

压缩 NFT 是 Solana 上的一种创新技术，通过 Merkle Tree 和状态压缩，将 NFT 数据存储成本降低 **1000 倍以上**。

**传统 NFT vs cNFT：**
- 传统 NFT：每个 NFT 约 0.012 SOL（~$2）
- cNFT：每个 cNFT 约 0.0001 SOL（~$0.02）

#### 工作原理

1. **创建 Merkle Tree** - 管理员创建一个 Merkle Tree 用于存储 cNFT
2. **铸造 cNFT** - 为文档项目铸造 cNFT，关联访问权限
3. **分发 cNFT** - 将 cNFT 转移给用户（购买、赠送等）
4. **验证访问** - 用户连接钱包，系统自动验证持有的 cNFT
5. **授予权限** - 验证通过后，用户可访问对应的文档项目

#### 技术优势

- ✅ **低成本** - 铸造成本降低 1000 倍
- ✅ **高性能** - 支持大规模铸造和验证
- ✅ **去中心化** - 权限数据存储在区块链上
- ✅ **可转移** - cNFT 可以自由转移和交易
- ✅ **可编程** - 支持自定义权限逻辑

---

## 📦 本地开发

### 环境要求

- Node.js 20+
- PostgreSQL 14+
- npm 9+

### 安装步骤

1. **克隆仓库**

```bash
git clone https://github.com/yourusername/slothvault.git
cd slothvault
```

2. **安装依赖**

```bash
npm install
```

3. **配置环境变量**

创建 `.env` 文件：

```env
# 数据库配置
DATABASE_URL="postgresql://postgres:password@localhost:5432/slothvault"

# 加密密钥（64+ 字符）
ENCRYPTION_KEY="your-64-character-encryption-key-here"

# Solana 配置（可选）
SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"
SOLANA_DEVNET_RPC_URL="https://api.devnet.solana.com"

# Filebase 配置（可选）
FILEBASE_ACCESS_KEY="your-filebase-access-key"
FILEBASE_SECRET_KEY="your-filebase-secret-key"
```

4. **初始化数据库**

```bash
# 运行迁移
npx prisma migrate dev

# 生成 Prisma Client
npx prisma generate
```

5. **启动开发服务器**

```bash
npm run dev
```

访问 `http://localhost:3000`

---

## 🎨 主题定制

SlothVault 提供了强大的主题系统，支持在 Markdown 内容中使用自定义样式类。

### 可用样式类

#### 文字颜色
- `sloth-text` - 主文字颜色
- `sloth-text-primary` - 主题色文字
- `sloth-text-gradient` - 渐变文字

#### 组件样式
- `sloth-card` - 卡片容器
- `sloth-btn sloth-btn-primary` - 主要按钮
- `sloth-badge-primary` - 主题色徽章

#### 布局工具
- `sloth-grid` - 响应式网格
- `sloth-flex` - Flex 容器
- `sloth-gap-4` - 间距

### 示例

```html
<div class="sloth-card">
  <h3 class="sloth-text-gradient">标题</h3>
  <p class="sloth-text-subtle">描述文字</p>
</div>
```

完整样式指南请参考文档末尾的 [Markdown 样式指南](#markdown-动态主题样式指南)。

---

## 🔧 配置说明

### Solana 配置

在管理后台 **系统设置** 中配置：

- **RPC URL** - Solana RPC 节点地址
- **网络选择** - Mainnet / Devnet
- **DAS API** - 用于 cNFT 验证的 API 端点

### Filebase 配置

Filebase 是 S3 兼容的 IPFS 存储服务：

1. 注册 [Filebase](https://filebase.com) 账号
2. 创建 Access Key 和 Secret Key
3. 在系统设置中配置密钥

---

## 📚 API 文档

### 认证 API

```
POST /api/admin/auth/login       # 登录
POST /api/admin/auth/init        # 初始化（创建首个用户）
GET  /api/admin/auth/check       # 检查认证状态
```

### 项目管理 API

```
GET    /api/admin/mm/project           # 项目列表
POST   /api/admin/mm/project           # 创建项目
GET    /api/admin/mm/project/[id]      # 项目详情
PUT    /api/admin/mm/project/[id]      # 更新项目
DELETE /api/admin/mm/project/[id]      # 删除项目
```

### Solana API

```
GET    /api/admin/solana/tree          # Merkle Tree 列表
POST   /api/admin/solana/tree/prepare  # 准备创建 Tree
POST   /api/admin/solana/tree/submit   # 提交创建 Tree
GET    /api/admin/solana/cnft          # cNFT 列表
POST   /api/admin/solana/cnft/prepare  # 准备铸造 cNFT
POST   /api/admin/solana/cnft/submit   # 提交铸造 cNFT
```

### 前台 API

```
GET  /api/project/list                 # 项目列表
GET  /api/project/[id]                 # 项目详情
POST /api/project/[id]/verify-access   # 验证访问权限
```

---

## 🚢 部署指南

### Docker 部署

推荐使用 Docker Compose 部署，它会同时启动 PostgreSQL 和 SlothVault：

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up -d
```

默认情况下，数据库文件会保存在本地 `./docker-data/postgres`，Nuxt 上传文件会保存在本地 `./docker-data/uploads`。

如果你已经有 PostgreSQL，可以使用 `docker run` 并传入 `DATABASE_URL` 或 `DB_HOST` / `DB_USER` / `DB_PASSWORD` 等数据库配置。

### 传统部署

1. 安装 Node.js 20+ 和 PostgreSQL 14+
2. 克隆代码并安装依赖
3. 配置环境变量
4. 运行数据库迁移
5. 构建生产版本：`npm run build`
6. 启动服务：`node .output/server/index.mjs`

### 反向代理配置

使用 Nginx 配置 HTTPS：

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 🤝 贡献指南

欢迎贡献代码、报告问题或提出建议！

### 开发流程

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request

### 代码规范

- 使用 TypeScript
- 遵循 Vue 3 Composition API 风格
- 添加必要的注释和文档

---

## 📄 开源协议

本项目采用 [MIT License](LICENSE) 开源协议。

---

## 🙏 致谢

感谢以下开源项目：

- [Nuxt](https://nuxt.com) - 全栈 Vue 框架
- [Solana](https://solana.com) - 高性能区块链
- [Element Plus](https://element-plus.org) - Vue 3 UI 组件库
- [Prisma](https://www.prisma.io) - 现代化 ORM
- [Filebase](https://filebase.com) - IPFS 存储服务

---

## 📞 联系方式

- GitHub Issues: [提交问题](https://github.com/yourusername/slothvault/issues)
- Email: your-email@example.com
- Twitter: [@yourhandle](https://twitter.com/yourhandle)

---

<div align="center">

**⭐ 如果这个项目对你有帮助，请给一个 Star！**

Made with ❤️ by SlothVault Team

</div>

---

## Markdown 动态主题样式指南

SlothVault 支持在 Markdown 内容中使用 HTML 标签，并且这些 HTML 元素可以跟随系统主题（light/dark）和配色（purple/cyan/emerald/rose）动态切换样式。

### 使用方法

在 Markdown 的 HTML 标签中使用 `sloth-*` 类名，这些样式会自动响应主题变化：

```html
<p class="sloth-text-primary">这段文字会跟随主题配色变化</p>

<div class="sloth-card">
  <h3 class="sloth-text-gradient">渐变标题</h3>
  <p class="sloth-text-subtle">次要说明文字</p>
</div>
```

### 可用样式类

#### 文字颜色

| 类名 | 说明 |
|------|------|
| `sloth-text` | 主文字颜色 |
| `sloth-text-subtle` | 次要文字颜色 |
| `sloth-text-primary` | 主题色文字（跟随配色切换） |
| `sloth-text-accent` | 强调色文字 |
| `sloth-text-danger` | 危险/错误色文字 |
| `sloth-text-inverse` | 反色文字（用于深色背景） |
| `sloth-text-gradient` | 渐变文字（跟随配色切换） |

#### 背景颜色

| 类名 | 说明 |
|------|------|
| `sloth-bg` | 页面背景色 |
| `sloth-bg-hover` | 悬停背景色 |
| `sloth-bg-card` | 卡片背景色 |
| `sloth-bg-primary` | 主题色背景 |
| `sloth-bg-primary-dim` | 主题色淡背景 |
| `sloth-bg-gradient` | 渐变背景 |

#### 组件样式

| 类名 | 说明 |
|------|------|
| `sloth-card` | 卡片容器（带边框、阴影、悬停效果） |
| `sloth-highlight-card` | 高亮卡片（带渐变背景装饰） |
| `sloth-btn sloth-btn-primary` | 主要按钮（渐变背景） |
| `sloth-btn sloth-btn-secondary` | 次要按钮（边框样式） |
| `sloth-badge` | 默认徽章/标签 |
| `sloth-badge-primary` | 主题色徽章 |
| `sloth-icon-box` | 图标容器 |
| `sloth-icon-box-primary` | 主题色图标容器（渐变背景） |

#### 布局工具

| 类名 | 说明 |
|------|------|
| `sloth-grid` | 响应式网格（自动适配列数） |
| `sloth-flex` | Flex 容器 |
| `sloth-flex-center` | 居中 Flex |
| `sloth-flex-between` | 两端对齐 Flex |
| `sloth-flex-col` | 纵向 Flex |
| `sloth-gap-2` / `sloth-gap-4` / `sloth-gap-6` | 间距 8px / 16px / 24px |

#### 间距

| 类名 | 说明 |
|------|------|
| `sloth-p-4` / `sloth-p-6` | 内边距 16px / 24px |
| `sloth-py-4` / `sloth-px-4` | 垂直/水平内边距 16px |
| `sloth-mt-4` / `sloth-mb-4` / `sloth-my-4` | 上/下/垂直外边距 16px |

#### 其他

| 类名 | 说明 |
|------|------|
| `sloth-text-center` | 文字居中 |
| `sloth-text-xl` / `sloth-text-2xl` / `sloth-text-3xl` | 字号 1.25rem / 1.5rem / 1.875rem |
| `sloth-font-bold` / `sloth-font-semibold` | 字重 700 / 600 |
| `sloth-rounded` | 圆角（使用主题圆角变量） |
| `sloth-rounded-full` | 完全圆角 |
| `sloth-shadow` | 阴影 |
| `sloth-border` / `sloth-border-primary` | 边框颜色 |

### 示例：功能卡片网格

```html
<div class="sloth-grid">
  <div class="sloth-card">
    <div class="sloth-icon-box" style="margin-bottom: 16px;">
      <svg>...</svg>
    </div>
    <h4 class="sloth-text sloth-font-semibold">功能标题</h4>
    <p class="sloth-text-subtle">功能描述文字</p>
  </div>
  <!-- 更多卡片... -->
</div>
```

### 示例：高亮特性区块

```html
<div class="sloth-highlight-card">
  <div class="sloth-flex sloth-gap-4">
    <div class="sloth-icon-box-primary">
      <svg stroke="white">...</svg>
    </div>
    <div>
      <h3 class="sloth-text sloth-font-bold">特性标题</h3>
      <p class="sloth-text-subtle">特性描述</p>
      <div class="sloth-flex sloth-gap-2" style="margin-top: 12px;">
        <span class="sloth-badge-primary">标签1</span>
        <span class="sloth-badge-primary">标签2</span>
      </div>
    </div>
  </div>
</div>
```

### 注意事项

1. **避免硬编码颜色**：不要在 HTML 中使用 `color: #333` 这样的硬编码颜色，应使用 `sloth-*` 类或 CSS 变量
2. **SVG 图标颜色**：将 `stroke` 或 `fill` 设为 `currentColor`，通过父元素的 `sloth-text-*` 类控制颜色
3. **自定义样式**：如需额外样式，使用内联 `style` 配合 CSS 变量：`style="color: var(--sloth-primary)"`

### CSS 变量参考

如需在内联样式中使用，以下是可用的 CSS 变量：

```css
--sloth-bg              /* 页面背景 */
--sloth-bg-hover        /* 悬停背景 */
--sloth-card            /* 卡片背景 */
--sloth-card-border     /* 卡片边框 */
--sloth-text            /* 主文字 */
--sloth-text-subtle     /* 次要文字 */
--sloth-primary         /* 主题色 */
--sloth-primary-hover   /* 主题色悬停 */
--sloth-primary-dim     /* 主题色淡 */
--sloth-accent          /* 强调色 */
--sloth-danger          /* 危险色 */
--sloth-radius          /* 圆角 */
--sloth-shadow          /* 阴影 */
--sloth-gradient-primary /* 主题渐变 */
--sloth-gradient-text   /* 文字渐变 */
```
