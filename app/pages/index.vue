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

      <!-- 导航链接 -->
      <div class="nav-links">
        <NuxtLink to="/" class="nav-link">{{ t('Nav.home') }}</NuxtLink>
        <NuxtLink to="/project/projectList" class="nav-link">{{ t('Nav.projects') }}</NuxtLink>
        <a href="https://discord.gg/your-invite" class="nav-link nav-icon" target="_blank" rel="noopener" :title="t('Nav.discord')">
          <svg viewBox="0 0 24 24" fill="currentColor" class="social-icon">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
          </svg>
        </a>
        <a href="https://github.com/your-repo" class="nav-link nav-icon" target="_blank" rel="noopener" :title="t('Nav.github')">
          <svg viewBox="0 0 24 24" fill="currentColor" class="social-icon">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
        </a>
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
  height: 60px;
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

/* 导航链接 */
.nav-links {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-link {
  padding: 8px 16px;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--sloth-text);
  text-decoration: none;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.nav-link:hover {
  color: var(--sloth-primary);
  background: var(--sloth-bg-hover);
}

.nav-link.router-link-active {
  color: var(--sloth-primary);
}

.nav-icon {
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.social-icon {
  width: 20px;
  height: 20px;
}

/* 2. Hero 区域 */
.hero-section {
  padding: 40px 0 30px;
  position: relative;
}

.hero-card {
  text-align: center;
  padding: 60px 24px;
  background: transparent;
  border: none;
  box-shadow: none;
}

.dark .hero-card {
  background: transparent;
  border: none;
  box-shadow: none;
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
  margin-bottom: 12px;
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

/* 4. Highlight Card (Solana) */
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

  .nav-links {
    display: none;
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