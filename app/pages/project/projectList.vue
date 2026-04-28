<script setup lang="ts">
const {t} = useI18n()
const walletStore = useWalletStore()
const { setPageTitle } = usePageTitle()

// 设置页面标题
setPageTitle('projects')

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

// 使用项目列表鉴权
const { hasAccess, batchVerify, loading: authLoading } = useProjectListAuth()

// 当项目列表加载完成且钱包已连接时，批量验证需要鉴权的项目
watch(
  [() => projects.value, () => walletStore.connected],
  ([projectList, connected]) => {
    if (connected && projectList.length > 0) {
      const authRequiredIds = projectList
        .filter(p => p.requireAuth)
        .map(p => p.id)
      if (authRequiredIds.length > 0) {
        batchVerify(authRequiredIds)
      }
    }
  },
  { immediate: true }
)

// 检查项目是否可访问
function canAccessProject(project: Project): boolean {
  return hasAccess(project.id, project.requireAuth)
}

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString()
}
</script>

<template>
  <div class="projects-page">

    <!-- 液态玻璃导航栏 -->
    <LiquidNavbar />

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
                <span v-if="project.requireAuth" class="auth-badge" :class="{ 'is-unlocked': canAccessProject(project) }">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0110 0v4"/>
                  </svg>
                  {{ canAccessProject(project) ? t('ProjectsPage.unlocked') : t('ProjectsPage.requireAuth') }}
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
  background: linear-gradient(to bottom, #fafafa 0%, #ffffff 100%);
}

.dark .projects-page {
  background: linear-gradient(to bottom, #000000 0%, #0a0a0a 100%);
}

/* 页面头部 */
.page-header {
  padding: 100px 0 40px;
  text-align: center;
}

.page-title {
  font-size: 40px;
  font-weight: 700;
  margin-bottom: 12px;
  letter-spacing: -0.022em;
  background: linear-gradient(135deg, #1d1d1f 0%, #4a4a4a 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.dark .page-title {
  background: linear-gradient(135deg, #ffffff 0%, #a0a0a0 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.page-desc {
  color: #86868b;
  font-size: 17px;
  line-height: 1.52941;
  letter-spacing: -0.022em;
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
  color: #86868b;
}

.loading-state p,
.error-state p,
.empty-state p {
  font-size: 15px;
  line-height: 1.52941;
  font-weight: 400;
  letter-spacing: -0.022em;
  margin: 0;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 2.5px solid rgba(0, 0, 0, 0.08);
  border-top-color: #0071e3;
  border-radius: 50%;
  margin: 0 auto 20px;
  animation: spin 0.7s linear infinite;
}

.dark .loading-spinner {
  border-color: rgba(255, 255, 255, 0.1);
  border-top-color: #0a84ff;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.empty-icon {
  width: 56px;
  height: 56px;
  margin: 0 auto 20px;
  opacity: 0.3;
  color: #86868b;
}

.error-state p {
  color: #d70015;
}

.dark .error-state p {
  color: #ff453a;
}

/* 项目网格 */
.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 20px;
}

/* 项目卡片 */
.project-card {
  position: relative;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  padding: 24px;
  text-decoration: none;
  color: var(--sloth-text, #1d1d1f);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  animation: cardFadeIn 0.5s ease forwards;
  animation-delay: var(--delay);
  opacity: 0;
  transform: translateY(16px);
  overflow: hidden;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.dark .project-card {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
  color: #f5f5f7;
}

@keyframes cardFadeIn {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.project-card:hover {
  border-color: #0071e3;
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
}

.dark .project-card:hover {
  border-color: #0a84ff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
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
  background: rgba(0, 0, 0, 0.04);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.dark .project-icon {
  background: rgba(255, 255, 255, 0.08);
}

.project-avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  font-size: 20px;
  font-weight: 600;
  color: #0071e3;
  text-transform: uppercase;
}

.dark .avatar-placeholder {
  color: #0a84ff;
}

.card-badges {
  display: flex;
  align-items: center;
  gap: 6px;
}

.auth-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  padding: 4px 8px;
  background: rgba(255, 149, 0, 0.1);
  color: #ff9500;
  border-radius: 6px;
  border: 1px solid rgba(255, 149, 0, 0.2);
  letter-spacing: -0.016em;
}

.dark .auth-badge {
  background: rgba(255, 159, 10, 0.15);
  color: #ff9f0a;
  border-color: rgba(255, 159, 10, 0.3);
}

.auth-badge svg {
  width: 11px;
  height: 11px;
}

.auth-badge.is-unlocked {
  background: rgba(52, 199, 89, 0.1);
  color: #34c759;
  border-color: rgba(52, 199, 89, 0.2);
}

.dark .auth-badge.is-unlocked {
  background: rgba(48, 209, 88, 0.15);
  color: #30d158;
  border-color: rgba(48, 209, 88, 0.3);
}

.version-badge {
  font-size: 11px;
  font-weight: 500;
  padding: 4px 8px;
  background: rgba(0, 113, 227, 0.1);
  color: #0071e3;
  border-radius: 6px;
  border: 1px solid rgba(0, 113, 227, 0.2);
  letter-spacing: -0.016em;
}

.dark .version-badge {
  background: rgba(10, 132, 255, 0.15);
  color: #0a84ff;
  border-color: rgba(10, 132, 255, 0.3);
}

.project-name {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 8px;
  position: relative;
  z-index: 1;
  letter-spacing: -0.022em;
  color: var(--sloth-text, #1d1d1f);
}

.dark .project-name {
  color: #f5f5f7;
}

.project-desc {
  font-size: 14px;
  color: #86868b;
  line-height: 1.5;
  margin-bottom: 16px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  position: relative;
  z-index: 1;
  letter-spacing: -0.016em;
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
  font-size: 13px;
  color: #86868b;
  letter-spacing: -0.016em;
}

.meta-item svg {
  width: 14px;
  height: 14px;
  opacity: 0.6;
}

.card-arrow {
  position: absolute;
  right: 20px;
  bottom: 20px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: translateX(-8px);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.card-arrow svg {
  width: 18px;
  height: 18px;
  color: #0071e3;
}

.dark .card-arrow svg {
  color: #0a84ff;
}

.project-card:hover .card-arrow {
  opacity: 1;
  transform: translateX(0);
}

/* 响应式 */
@media (max-width: 768px) {
  .page-header {
    padding: 80px 0 30px;
  }

  .page-title {
    font-size: 32px;
  }

  .page-desc {
    font-size: 15px;
  }

  .projects-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .project-card {
    padding: 20px;
  }

  .loading-spinner {
    width: 28px;
    height: 28px;
  }
}

@media (max-width: 480px) {
  .page-title {
    font-size: 28px;
  }

  .project-name {
    font-size: 18px;
  }
}
</style>
