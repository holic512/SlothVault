<script setup lang="ts">
const {t} = useI18n()

interface Project {
  id: string
  projectName: string
  avatar: string | null
  latestVersion: string | null
  latestVersionDesc: string | null
  categoryCount: number
  requireAuth: boolean
  updatedAt: string
}

const {data, pending, error} = await useFetch<{ code: number; data: Project[] }>('/api/project/list')

const projects = computed(() => data.value?.data || [])

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString()
}
</script>

<template>
  <div class="projects-page">
    <!-- 背景光效 -->
    <div class="ambient-glow glow-1"></div>
    <div class="ambient-glow glow-2"></div>

    <!-- 导航栏 -->
    <nav class="navbar">
      <div class="sloth-container sloth-flex-between" style="height: 100%;">
        <NuxtLink to="/public" class="brand">
          <img src="/logo.png" class="brand-icon" alt="Logo"/>
          <span class="brand-text">Sloth<span class="sloth-text-gradient">Vault</span></span>
        </NuxtLink>

        <div class="nav-links">
          <NuxtLink to="/" class="nav-link">{{ t('Nav.home') }}</NuxtLink>
          <NuxtLink to="/project/projectList" class="nav-link">{{ t('Nav.projects') }}</NuxtLink>
          <a href="https://discord.gg/your-invite" class="nav-link nav-icon" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="currentColor" class="social-icon">
              <path
                  d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
          </a>
          <a href="https://github.com/your-repo" class="nav-link nav-icon" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="currentColor" class="social-icon">
              <path
                  d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </a>
        </div>

        <ThemeToggle/>
      </div>
    </nav>

    <!-- 页面头部 -->
    <header class="page-header">
      <div class="sloth-container">
        <h1 class="page-title">{{ t('ProjectsPage.title') }}</h1>
        <p class="page-desc">{{ t('ProjectsPage.desc') }}</p>
      </div>
    </header>

    <!-- 项目列表 -->
    <section class="projects-section">
      <div class="sloth-container">
        <!-- 加载状态 -->
        <div v-if="pending" class="loading-state">
          <div class="loading-spinner"></div>
          <p>{{ t('ProjectsPage.loading') }}</p>
        </div>

        <!-- 错误状态 -->
        <div v-else-if="error" class="error-state">
          <p>{{ t('ProjectsPage.error') }}</p>
        </div>

        <!-- 空状态 -->
        <div v-else-if="projects.length === 0" class="empty-state">
          <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
          </svg>
          <p>{{ t('ProjectsPage.empty') }}</p>
        </div>

        <!-- 项目卡片网格 -->
        <div v-else class="projects-grid">
          <NuxtLink
              v-for="(project, index) in projects"
              :key="project.id"
              :to="`/project/${project.id}/home`"
              class="project-card"
              :style="{ '--delay': index * 60 + 'ms' }"
          >
            <div class="card-header">
              <div class="project-icon">
                <img v-if="project.avatar" :src="project.avatar" class="project-avatar" alt="项目头像"/>
                <span v-else class="avatar-placeholder">{{ project.projectName?.charAt(0) || '?' }}</span>
              </div>
              <div class="card-badges">
                <span v-if="project.requireAuth" class="auth-badge">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0110 0v4"/>
                  </svg>
                  {{ t('ProjectsPage.requireAuth') }}
                </span>
                <span v-if="project.latestVersion" class="version-badge">
                  {{ project.latestVersion }}
                </span>
              </div>
            </div>

            <h3 class="project-name">{{ project.projectName }}</h3>

            <p v-if="project.latestVersionDesc" class="project-desc">
              {{ project.latestVersionDesc }}
            </p>

            <div class="card-footer">
              <div class="meta-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 6h16M4 12h16M4 18h7"/>
                </svg>
                <span>{{ project.categoryCount }} {{ t('ProjectsPage.categories') }}</span>
              </div>
              <div class="meta-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
                <span>{{ formatDate(project.updatedAt) }}</span>
              </div>
            </div>

            <div class="card-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </div>
          </NuxtLink>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.projects-page {
  min-height: 100vh;
  position: relative;
}

/* 背景光效 */
.ambient-glow {
  position: fixed;
  border-radius: 50%;
  filter: blur(80px);
  z-index: -1;
  opacity: 0.3;
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
  bottom: 20%;
  right: -50px;
  opacity: 0.15;
}

/* 导航栏 */
.navbar {
  position: sticky;
  top: 0;
  z-index: 50;
  height: 70px;
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
  text-decoration: none;
  color: var(--sloth-text);
}

.brand-icon {
  width: 28px;
  height: 28px;
}

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

/* 页面头部 */
.page-header {
  padding: 60px 0 40px;
  text-align: center;
}

.page-title {
  font-size: 2.5rem;
  font-weight: 700;
  margin-bottom: 12px;
  letter-spacing: -0.02em;
}

.page-desc {
  color: var(--sloth-text-subtle);
  font-size: 1.1rem;
}

/* 项目区域 */
.projects-section {
  padding: 20px 0 80px;
}

/* 状态样式 */
.loading-state,
.error-state,
.empty-state {
  text-align: center;
  padding: 80px 20px;
  color: var(--sloth-text-subtle);
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--sloth-card-border);
  border-top-color: var(--sloth-primary);
  border-radius: 50%;
  margin: 0 auto 16px;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.empty-icon {
  width: 64px;
  height: 64px;
  margin-bottom: 16px;
  opacity: 0.5;
}

/* 项目网格 */
.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 24px;
}

/* 项目卡片 */
.project-card {
  position: relative;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: 16px;
  padding: 24px;
  text-decoration: none;
  color: var(--sloth-text);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  animation: cardFadeIn 0.4s ease forwards;
  animation-delay: var(--delay);
  opacity: 0;
  transform: translateY(20px);
  overflow: hidden;
}

@keyframes cardFadeIn {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.project-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, var(--sloth-primary-dim) 0%, transparent 50%);
  opacity: 0;
  transition: opacity 0.3s;
}

.project-card:hover {
  border-color: var(--sloth-primary);
  transform: translateY(-4px);
}

.project-card:hover::before {
  opacity: 0.5;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  position: relative;
  z-index: 1;
}

.project-icon {
  width: 48px;
  height: 48px;
  background: var(--sloth-bg-hover);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.project-avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--sloth-primary);
  text-transform: uppercase;
}

.project-icon svg {
  width: 24px;
  height: 24px;
  color: var(--sloth-text-subtle);
}

.version-badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 4px 10px;
  background: var(--sloth-primary-dim);
  color: var(--sloth-primary);
  border-radius: 20px;
  border: 1px solid var(--sloth-primary);
}

.card-badges {
  display: flex;
  align-items: center;
  gap: 8px;
}

.auth-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.7rem;
  font-weight: 500;
  padding: 4px 8px;
  background: rgba(251, 146, 60, 0.1);
  color: #f97316;
  border-radius: 20px;
  border: 1px solid rgba(251, 146, 60, 0.3);
}

.auth-badge svg {
  width: 12px;
  height: 12px;
}

.project-name {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 8px;
  position: relative;
  z-index: 1;
}

.project-desc {
  font-size: 0.9rem;
  color: var(--sloth-text-subtle);
  line-height: 1.5;
  margin-bottom: 16px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  position: relative;
  z-index: 1;
}

.card-footer {
  display: flex;
  gap: 16px;
  position: relative;
  z-index: 1;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--sloth-text-subtle);
}

.meta-item svg {
  width: 14px;
  height: 14px;
}

.card-arrow {
  position: absolute;
  right: 20px;
  bottom: 20px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: translateX(-10px);
  transition: all 0.3s;
}

.card-arrow svg {
  width: 20px;
  height: 20px;
  color: var(--sloth-primary);
}

.project-card:hover .card-arrow {
  opacity: 1;
  transform: translateX(0);
}

/* 响应式 */
@media (max-width: 768px) {
  .page-title {
    font-size: 1.8rem;
  }

  .projects-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .nav-links {
    display: none;
  }
}
</style>
