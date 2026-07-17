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

# 🦥 SlothVault

把项目、版本与 Markdown 文档收进一座安静、可控的私人知识库。

<div class="sloth-actions">
  <a class="sloth-btn sloth-btn-primary" href="/project/projectList">浏览项目</a>
  <a class="sloth-btn sloth-btn-secondary" href="/admin">管理控制台</a>
</div>

</div>

---

## 当前能力

<div class="sloth-feature-grid">
  <div class="sloth-feature-card"><strong>多项目与版本</strong><span>按项目、版本、分类和笔记组织内容。</span></div>
  <div class="sloth-feature-card"><strong>Markdown 工作流</strong><span>编辑、预览、图片上传与内容版本管理。</span></div>
  <div class="sloth-feature-card"><strong>受控访问</strong><span>公开内容与 Solana cNFT 权限可以并存。</span></div>
  <div class="sloth-feature-card"><strong>一体化后台</strong><span>项目、文件、设置、备份与链上资产统一管理。</span></div>
</div>

## 技术底座

- **应用框架**：Next.js 16 App Router + React 19
- **界面系统**：Ant Design + SlothVault 自定义主题
- **数据层**：PostgreSQL + Prisma ORM
- **链上能力**：Solana Wallet Adapter + cNFT
- **语言**：中文 / English
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
