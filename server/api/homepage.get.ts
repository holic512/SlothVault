import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { setResponseStatus } from 'h3'

// 默认首页模板内容
const DEFAULT_HOMEPAGE_CONTENT = `<div align="center">

# 🦥 欢迎来到 SlothVault

<p style="font-size: 1.2em; color: #666;">
一个基于 Nuxt 4 的现代化文档管理系统
</p>

</div>

---

## ✨ 核心特性

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 30px 0;">

<div style="padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
  <h3>📚 项目管理</h3>
  <p>支持多项目、多版本管理，灵活的分类体系</p>
</div>

<div style="padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
  <h3>📝 Markdown 编辑</h3>
  <p>强大的 Markdown 编辑器，支持实时预览和图片上传</p>
</div>

<div style="padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
  <h3>🔗 自定义菜单</h3>
  <p>灵活配置项目导航菜单，支持内外链跳转</p>
</div>

<div style="padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
  <h3>🔍 全文搜索</h3>
  <p>快速检索文档内容，精准定位所需信息</p>
</div>

<div style="padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
  <h3>💾 文件管理</h3>
  <p>统一的文件上传和管理系统</p>
</div>

<div style="padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
  <h3>⛓️ Solana 集成</h3>
  <p>基于 cNFT 的链上权限验证系统</p>
</div>

</div>

---

## 🚀 快速开始

### 1. 访问管理后台

点击右上角的 **控制台** 按钮，进入管理后台。

### 2. 创建项目

在项目管理页面创建你的第一个项目，配置版本和分类。

### 3. 编写文档

使用 Markdown 编辑器编写文档内容，支持丰富的格式和代码高亮。

### 4. 发布内容

设置项目状态为启用，即可在前台展示你的文档。

---

## 🎨 技术栈

- **框架**: Nuxt 4 (SSR + API routes)
- **前端**: Vue 3 Composition API, Element Plus, Pinia
- **数据库**: PostgreSQL with Prisma ORM
- **区块链**: Solana (web3.js, SPL Account Compression)
- **存储**: Filebase (S3-compatible IPFS pinning)
- **国际化**: @nuxtjs/i18n (en/zh)

---

<div align="center" style="margin-top: 40px; padding: 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; color: white;">

## 💡 开始使用

<p style="font-size: 1.1em; margin: 20px 0;">
立即进入管理后台，编辑这个首页内容，打造属于你的知识库！
</p>

<div style="margin-top: 20px;">
  <a href="/admin/mm/homepage" style="display: inline-block; padding: 12px 24px; background: white; color: #667eea; border-radius: 6px; text-decoration: none; font-weight: bold;">
    编辑首页
  </a>
</div>

</div>

---

<div align="center" style="color: #999; font-size: 0.9em; margin-top: 40px;">

Made with ❤️ by SlothVault Team

</div>`

/**
 * 获取系统首页内容（公开接口）
 * GET /api/homepage
 */
export default defineEventHandler(async (event) => {
  try {
    let homepage = await prisma.systemHomepage.findFirst({
      where: {
        isDeleted: false,
        status: 1,
      },
      orderBy: {
        id: 'desc',
      },
    })

    // 如果不存在，自动创建默认首页
    if (!homepage) {
      console.log('Homepage not found, creating default homepage...')
      homepage = await prisma.systemHomepage.create({
        data: {
          content: DEFAULT_HOMEPAGE_CONTENT,
          status: 1,
        },
      })
      console.log('Default homepage created successfully')
    }

    return ok({
      content: homepage.content,
    })
  } catch (err) {
    console.error('Error fetching homepage:', err)
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
