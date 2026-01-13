# SlothVault

基于 Nuxt 4 的个人文档管理系统，集成 Solana 区块链的 cNFT 版权/阅读权限功能。

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

新建 `.env` 文件，配置数据库地址（推荐使用空数据库）：

```env
DATABASE_URL="postgresql://postgres:123456@localhost:5432/slothvault"
```

### 3. 初始化数据库

```bash
npx prisma migrate dev --name init  # 初始化数据库配置
npx prisma generate                 # 生成 Prisma Client
```

### 4. 启动开发服务器

```bash
pnpm dev
```

## 数据库迁移

修改数据表结构后，使用以下指令同步：

```bash
npx prisma migrate dev --name <name>  # <name> 建议使用日期，方便溯源
npx prisma generate
```

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
4. **完整示例**：参考 `app.md` 文件，这是首页的 Markdown 版本，展示了所有样式类的实际用法

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
