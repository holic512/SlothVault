/**
 * @file homepage.ts
 * @project SlothVault
 * @module Homepage
 * @description Supplies the public homepage content without mutating the database from a GET request.
 * @logic Read the newest enabled homepage; when none exists or the database is unavailable, return a truthful Next.js fallback.
 * @dependencies Prisma SystemHomepage model
 * @index_tags homepage,markdown,fallback,public
 * @author holic512
 */
import 'server-only'

import { prisma } from '@/server/prisma'

export const DEFAULT_HOMEPAGE_CONTENT = `
<div class="sloth-hero-markdown">

# SlothVault

一套克制的 Web2 写作与个人主页系统。文章公开阅读，账户回归用户名与密码，链上能力只用于可选的版权凭证。

<div class="sloth-actions">
  <a class="sloth-btn sloth-btn-primary" href="/project/projectList">浏览文章</a>
  <a class="sloth-btn sloth-btn-secondary" href="/register">创建账户</a>
</div>

</div>

---

## 为长期写作而设计

<div class="sloth-feature-grid">
  <div class="sloth-feature-card"><strong>公开文章</strong><span>管理员负责发布，访客无需钱包即可阅读。</span></div>
  <div class="sloth-feature-card"><strong>个人主页</strong><span>普通用户拥有账户、资料页与可分享的主页地址。</span></div>
  <div class="sloth-feature-card"><strong>积分与卡密</strong><span>积分余额、完整流水、批量发卡和一次性兑换。</span></div>
  <div class="sloth-feature-card"><strong>版权凭证</strong><span>可为已发布文章制作 cNFT，作为链上版权证据。</span></div>
</div>

## 技术底座

- **应用框架**：Next.js 16 App Router + React 19
- **数据层**：SQLite / PostgreSQL / MySQL + Prisma ORM
- **短期状态**：Redis（登录挑战与安全限流）
- **登录方式**：用户名 / 邮箱 / 密码，或可选的钱包地址签名
- **链上能力**：Solana cNFT 文章版权凭证
`

export async function getHomepageContent() {
  try {
    const homepage = await prisma.systemHomepage.findFirst({
      where: { isDeleted: false, status: 1 },
      orderBy: { id: 'desc' },
      select: { content: true },
    })

    return homepage?.content || DEFAULT_HOMEPAGE_CONTENT
  } catch (error) {
    console.error('[homepage] Database unavailable; using fallback content', error)
    return DEFAULT_HOMEPAGE_CONTENT
  }
}
