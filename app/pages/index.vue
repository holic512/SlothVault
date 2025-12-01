<script setup>

const {t} = useI18n()

import {
  RectangleStackIcon, FolderIcon, DocumentTextIcon, LinkIcon,
  MagnifyingGlassIcon, ServerIcon, WalletIcon,
  CpuChipIcon
} from '@heroicons/vue/24/outline'

const features = [
  {title: t('IndexPage.features.project.title'), desc: t('IndexPage.features.project.desc'), icon: RectangleStackIcon},
  {title: t('IndexPage.features.category.title'), desc: t('IndexPage.features.category.desc'), icon: FolderIcon},
  {title: t('IndexPage.features.page.title'), desc: t('IndexPage.features.page.desc'), icon: LinkIcon},
  {title: t('IndexPage.features.htmlmd.title'), desc: t('IndexPage.features.htmlmd.desc'), icon: DocumentTextIcon},
  {title: t('IndexPage.features.search.title'), desc: t('IndexPage.features.search.desc'), icon: MagnifyingGlassIcon},
  {title: t('IndexPage.features.fs.title'), desc: t('IndexPage.features.fs.desc'), icon: ServerIcon},
]

const techs = ['Nuxt 4', 'PostgreSQL', 'Vector Search', 'Markdown', 'Solana', 'HTML']

const projectModel = ['id', 'name', 'slug', 'description', 'created_at']
const categoryModel = ['id', 'project_id', 'name', 'order', 'created_at']
const pageModel = ['id', 'category_id', 'title', 'content_type', 'content', 'route']


</script>

<template>
  <!-- 背景氛围光斑 (Web3 必备) -->
  <div class="ambient-glow glow-1"></div>
  <div class="ambient-glow glow-2"></div>

  <!-- 导航栏 -->
  <nav class="navbar">
    <div class="sloth-container sloth-flex-between" style="height: 100%;">
      <!--      logo    -->
      <div class="brand">
        <img src="/logo.png" class="brand-icon" alt="Logo"/>
        <span class="brand-text">Sloth<span class="sloth-text-gradient">Vault</span></span>
      </div>


      <!--    切换     -->
      <ThemeToggle/>
    </div>
  </nav>

  <!-- Hero 区域 -->
  <header class="hero-section">
    <div class="sloth-container">
      <div class="sloth-card hero-card">
        <div class="sloth-badge-hash hero-badge">
          <CpuChipIcon
              style="width: 16px; height: 16px; display: inline-block; vertical-align: -2px; margin-right: 4px;"/>
          {{ t('IndexPage.hero.badge') }}
        </div>

        <h1 class="hero-title">
          {{ t('IndexPage.hero.title_line1') }}<br/>
          <span class="sloth-text-gradient">{{ t('IndexPage.hero.title_line2') }}</span>
        </h1>

        <p class="hero-desc">
          {{ t('IndexPage.hero.desc') }}
        </p>

        <div class="hero-actions">
          <button class="sloth-btn sloth-btn-primary">
            {{ t('IndexPage.hero.actions.build') }}
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>
          <button class="sloth-btn sloth-btn-secondary" @click="navigateTo('/admin')">{{ t('IndexPage.hero.actions.console') }}</button>
        </div>
      </div>
    </div>
  </header>

  <!-- 功能特性 Grid -->
  <section class="section-spacing">
    <div class="sloth-container">
      <div class="section-header">
        <h2>{{ t('IndexPage.features.title') }}</h2>
        <p class="subtitle">{{ t('IndexPage.features.subtitle') }}</p>
      </div>

      <div class="sloth-grid">
        <div v-for="f in features" :key="f.title" class="sloth-card feature-card">
          <div class="feature-icon-box">
            <component :is="f.icon" class="feature-icon"/>
          </div>
          <h3 class="feature-title">{{ f.title }}</h3>
          <p class="feature-desc">{{ f.desc }}</p>
        </div>
      </div>
    </div>
  </section>

  <!-- 核心数据模型 -->
  <section class="section-spacing">
    <div class="sloth-container">
      <div class="sloth-flex-between mb-4 align-end-mobile">
        <div>
          <h2>{{ t('IndexPage.models.title') }}</h2>
          <p class="sloth-text-subtle mt-2">{{ t('IndexPage.models.subtitle') }}</p>
        </div>
        <div class="tech-tags">
          <span v-for="t in techs" :key="t" class="sloth-badge-hash">{{ t }}</span>
        </div>
      </div>

      <div class="sloth-grid three-cols">
        <!-- Project Model -->
        <div class="sloth-card model-card">
          <div class="model-header">
            <RectangleStackIcon class="w-5 h-5"/>
            <h3>{{ t('IndexPage.model.Project') }}</h3>
          </div>
          <div class="model-fields">
            <div v-for="f in projectModel" :key="f" class="model-field">
              <span class="field-dot"></span>{{ f }}
            </div>
          </div>
        </div>

        <!-- Category Model -->
        <div class="sloth-card model-card">
          <div class="model-header">
            <FolderIcon class="w-5 h-5"/>
            <h3>{{ t('IndexPage.model.Category') }}</h3>
          </div>
          <div class="model-fields">
            <div v-for="f in categoryModel" :key="f" class="model-field">
              <span class="field-dot"></span>{{ f }}
            </div>
          </div>
        </div>

        <!-- Page Model -->
        <div class="sloth-card model-card">
          <div class="model-header">
            <LinkIcon class="w-5 h-5"/>
            <h3>{{ t('IndexPage.model.Page') }}</h3>
          </div>
          <div class="model-fields">
            <div v-for="f in pageModel" :key="f" class="model-field">
              <span class="field-dot"></span>{{ f }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Solana & Wallet (特色功能) -->
  <section class="section-spacing">
    <div class="sloth-container">
      <div class="sloth-card highlight-card">
        <div class="highlight-content">
          <div class="icon-bg-primary">
            <WalletIcon class="w-8 h-8 text-white"/>
          </div>
          <div>
            <h2 class="text-xl font-bold mb-2">{{ t('IndexPage.highlight.title') }}</h2>
            <p class="text-subtle">
              {{ t('IndexPage.highlight.desc') }}
            </p>
            <div class="highlight-tags">
              <span class="sloth-badge-hash">{{ t('IndexPage.highlight.tags.walletSign') }}</span>
              <span class="sloth-badge-hash">{{ t('IndexPage.highlight.tags.onChainCert') }}</span>
              <span class="sloth-badge-hash">{{ t('IndexPage.highlight.tags.permissionCheck') }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- CTA Footer -->
  <section class="section-spacing pb-20">
    <div class="sloth-container">
      <div class="sloth-card cta-card">
        <div class="cta-text">
          <h3>{{ t('IndexPage.cta.title') }}</h3>
          <p>{{ t('IndexPage.cta.desc') }}</p>
        </div>
        <div class="cta-buttons">
          <button class="sloth-btn sloth-btn-primary">{{ t('IndexPage.cta.buttons.create') }}</button>
          <button class="sloth-btn sloth-btn-ghost">{{ t('IndexPage.cta.buttons.docs') }}</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* ===========================
   局部样式补充
   =========================== */

/* 1. 导航栏 */
.navbar {
  position: sticky;
  top: 0;
  z-index: 50;
  height: 70px;
  background: rgba(var(--sloth-bg-rgb), 0.7); /* 需配合 theme 调整或直接用 card 颜色 */
  background: var(--sloth-card);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--sloth-card-border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 1.2rem;
}

.brand-icon {
  width: 28px;
  height: 28px;
  color: var(--sloth-primary);
}

/* 2. Hero 区域 */
.hero-section {
  padding: 80px 0 60px;
  position: relative;
}

.hero-card {
  text-align: center;
  padding: 60px 24px;
  /* 让 Hero 卡片稍微透明一点，透出背景光 */
  background: rgba(255, 255, 255, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.dark .hero-card {
  background: rgba(20, 20, 20, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.hero-badge {
  margin-bottom: 24px;
  border-color: var(--sloth-primary);
  color: var(--sloth-primary);
  background: var(--sloth-primary-dim);
}

.hero-title {
  font-size: 3rem;
  line-height: 1.1;
  margin-bottom: 24px;
  letter-spacing: -0.03em;
}

.hero-desc {
  max-width: 680px;
  margin: 0 auto 32px;
  color: var(--sloth-text-subtle);
  font-size: 1.125rem;
}

.hero-actions {
  display: flex;
  justify-content: center;
  gap: 16px;
}

/* 3. 功能网格 */
.section-spacing {
  padding: 40px 0;
}

.section-header {
  margin-bottom: 32px;
}

.subtitle {
  color: var(--sloth-text-subtle);
  margin-top: 8px;
}

.feature-card {
  transition: transform 0.3s ease, border-color 0.3s ease;
}

.feature-icon-box {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: var(--sloth-bg-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  transition: background 0.3s ease;
}

.feature-card:hover .feature-icon-box {
  background: var(--sloth-primary);
}

.feature-icon {
  width: 24px;
  height: 24px;
  color: var(--sloth-text);
  transition: color 0.3s ease;
}

.feature-card:hover .feature-icon {
  color: #fff;
}

.feature-title {
  font-size: 1.1rem;
  margin-bottom: 8px;
}

.feature-desc {
  font-size: 0.95rem;
  color: var(--sloth-text-subtle);
  line-height: 1.5;
}

/* 4. 数据模型 */
.tech-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.model-card {
  padding: 0; /* 重置 padding 用于内部布局 */
  overflow: hidden;
}

.model-header {
  padding: 16px 20px;
  background: var(--sloth-bg-hover);
  border-bottom: 1px solid var(--sloth-card-border);
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
}

.model-fields {
  padding: 16px 20px;
  font-family: var(--sloth-font-mono), serif;
  font-size: 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.model-field {
  display: flex;
  align-items: center;
  color: var(--sloth-text-subtle);
}

.field-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--sloth-card-border);
  margin-right: 10px;
}

.model-card:hover .field-dot {
  background: var(--sloth-accent);
}

/* 5. Highlight Card (Solana) */
.highlight-card {
  border: 1px solid var(--sloth-primary-dim);
  position: relative;
  overflow: hidden;
}

/* 给这个卡片加一点微弱的渐变背景 */
.highlight-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(120deg, var(--sloth-primary-dim) 0%, transparent 40%);
  opacity: 0.3;
  z-index: 0;
}

.highlight-content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  gap: 24px;
}

.icon-bg-primary {
  background: var(--sloth-gradient-primary);
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 8px 16px rgba(124, 58, 237, 0.3);
}

.text-white {
  color: #fff;
}

.highlight-tags {
  margin-top: 16px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

/* 6. CTA Footer */
.cta-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 20px;
  background: linear-gradient(to right, var(--sloth-card), var(--sloth-bg));
}

.cta-text h3 {
  font-size: 1.5rem;
  margin-bottom: 8px;
}

.cta-text p {
  color: var(--sloth-text-subtle);
}

.cta-buttons {
  display: flex;
  gap: 12px;
}

/* 7. Ambient Glow (背景氛围光) */
.ambient-glow {
  position: fixed;
  border-radius: 50%;
  filter: blur(80px);
  z-index: -1;
  opacity: 0.4;
  pointer-events: none;
}

.glow-1 {
  width: 400px;
  height: 400px;
  background: var(--sloth-primary);
  top: -100px;
  left: -100px;
}

.glow-2 {
  width: 300px;
  height: 300px;
  background: var(--sloth-accent);
  bottom: 10%;
  right: -50px;
  opacity: 0.2;
}

/* Mobile 适配调整 */
@media (max-width: 768px) {
  .hero-title {
    font-size: 2rem;
  }

  .hero-actions {
    flex-direction: column;
  }

  .highlight-content {
    flex-direction: column;
  }

  .cta-card {
    flex-direction: column;
    text-align: center;
  }

  .cta-buttons {
    width: 100%;
    justify-content: center;
  }

  .align-end-mobile {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }
}

/* 简单辅助类 */
.mt-2 {
  margin-top: 0.5rem;
}

.mb-2 {
  margin-bottom: 0.5rem;
}

.w-5 {
  width: 1.25rem;
}

.h-5 {
  height: 1.25rem;
}

.w-8 {
  width: 2rem;
}

.h-8 {
  height: 2rem;
}
</style>
