<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Loading,
  User,
  Folder,
  Collection,
  Document,
  Files,
  Coin
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'

definePageMeta({
  layout: 'admin-mm'
})

const { t } = useI18n()
const { setPageTitle } = usePageTitle()
const router = useRouter()

// 设置页面标题
setPageTitle('adminDashboard')

type ApiResponse<T> = {
  code: number
  message: string
  data: T
}

type DashboardData = {
  overview: {
    users: {
      total: number
      activeSessions: number
      expiredSessions: number
    }
    projects: {
      total: number
      active: number
      withAuth: number
      inactive: number
    }
    versions: {
      total: number
      active: number
      inactive: number
    }
    categories: {
      total: number
      active: number
      inactive: number
    }
    notes: {
      total: number
      active: number
      inactive: number
      withMultipleVersions: number
    }
    noteContents: {
      total: number
      primary: number
      secondary: number
    }
    files: {
      total: number
      active: number
      totalSizeBytes: string
      totalSizeMB: string
      byType: Array<{
        type: string
        count: number
        sizeBytes: string
        sizeMB: string
      }>
    }
    blockchain: {
      merkleTrees: {
        total: number
        active: number
        full: number
      }
      cnfts: {
        total: number
        minted: number
        failed: number
        pending: number
      }
    }
  }
  recentActivity: {
    projects: Array<{
      id: string
      name: string
      status: number
      requireAuth: boolean
      versionCount: number
      createdAt: string | Date
    }>
    notes: Array<{
      id: string
      title: string
      status: number
      project: string
      version: string
      category: string
      createdAt: string | Date
    }>
    files: Array<{
      id: string
      originalName: string
      fileName: string
      sizeBytes: string
      sizeMB: string
      businessType: string
      createdAt: string | Date
    }>
    sessions: Array<{
      id: string
      username: string
      ip: string
      createdAt: string | Date
      expiresAt: string | Date
      isActive: boolean
      isRevoked: boolean
    }>
  }
  health: {
    projectUtilization: string
    noteUtilization: string
    categoryUtilization: string
    cnftSuccessRate: string
    merkleTreeUtilization: string
  }
}

const loading = ref(false)
const dashboardData = ref<DashboardData | null>(null)

function formatTime(value: string | Date) {
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '-'
  return dayjs(d).format('YYYY-MM-DD HH:mm:ss')
}

function formatTimeShort(value: string | Date) {
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '-'
  return dayjs(d).format('MM-DD HH:mm')
}

async function apiFetch<T>(url: string, options?: any): Promise<T> {
  const res = await $fetch<ApiResponse<T>>(url, options)
  if (res?.code === 0) return res.data
  if (res?.code === 401) {
    await router.push('/admin/auth/login')
    throw new Error('Unauthorized')
  }
  throw new Error(res?.message || '请求失败')
}

async function fetchDashboard() {
  loading.value = true
  try {
    const data = await apiFetch<DashboardData>('/api/admin/mm/dashboard', {
      method: 'GET',
    })
    dashboardData.value = data
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || t('AdminMM.dashboard.messages.loadFailed'))
    }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchDashboard()
})
</script>

<template>
  <div class="page-container">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">{{ $t('AdminMM.dashboard.title') }}</h1>
        <p class="page-desc">{{ $t('AdminMM.dashboard.desc') }}</p>
      </div>
      <div class="header-right">
        <el-button @click="fetchDashboard" :loading="loading">
          {{ $t('AdminMM.dashboard.actions.refresh') }}
        </el-button>
      </div>
    </div>

    <div v-if="loading && !dashboardData" class="loading-container">
      <el-icon class="is-loading"><Loading /></el-icon>
      <p>{{ $t('AdminMM.dashboard.messages.loading') }}</p>
    </div>

    <div v-else-if="dashboardData" class="dashboard-content">
      <!-- 概览统计卡片 -->
      <div class="stats-grid">
        <!-- 用户统计 -->
        <div class="stat-card">
          <div class="stat-icon user-icon">
            <el-icon><User /></el-icon>
          </div>
          <div class="stat-content">
            <div class="stat-label">{{ $t('AdminMM.dashboard.stats.users') }}</div>
            <div class="stat-value">{{ dashboardData.overview.users.total }}</div>
            <div class="stat-detail">
              <span class="detail-item success">{{ dashboardData.overview.users.activeSessions }} {{ $t('AdminMM.dashboard.stats.activeSessions') }}</span>
            </div>
          </div>
        </div>

        <!-- 项目统计 -->
        <div class="stat-card">
          <div class="stat-icon project-icon">
            <el-icon><Folder /></el-icon>
          </div>
          <div class="stat-content">
            <div class="stat-label">{{ $t('AdminMM.dashboard.stats.projects') }}</div>
            <div class="stat-value">{{ dashboardData.overview.projects.total }}</div>
            <div class="stat-detail">
              <span class="detail-item success">{{ dashboardData.overview.projects.active }} {{ $t('AdminMM.dashboard.stats.active') }}</span>
              <span class="detail-item">{{ dashboardData.overview.projects.withAuth }} {{ $t('AdminMM.dashboard.stats.withAuth') }}</span>
            </div>
          </div>
        </div>

        <!-- 分类统计 -->
        <div class="stat-card">
          <div class="stat-icon category-icon">
            <el-icon><Collection /></el-icon>
          </div>
          <div class="stat-content">
            <div class="stat-label">{{ $t('AdminMM.dashboard.stats.categories') }}</div>
            <div class="stat-value">{{ dashboardData.overview.categories.total }}</div>
            <div class="stat-detail">
              <span class="detail-item success">{{ dashboardData.overview.categories.active }} {{ $t('AdminMM.dashboard.stats.active') }}</span>
            </div>
          </div>
        </div>

        <!-- 笔记统计 -->
        <div class="stat-card">
          <div class="stat-icon note-icon">
            <el-icon><Document /></el-icon>
          </div>
          <div class="stat-content">
            <div class="stat-label">{{ $t('AdminMM.dashboard.stats.notes') }}</div>
            <div class="stat-value">{{ dashboardData.overview.notes.total }}</div>
            <div class="stat-detail">
              <span class="detail-item success">{{ dashboardData.overview.notes.active }} {{ $t('AdminMM.dashboard.stats.active') }}</span>
              <span class="detail-item">{{ dashboardData.overview.noteContents.total }} {{ $t('AdminMM.dashboard.stats.versions') }}</span>
            </div>
          </div>
        </div>

        <!-- 文件统计 -->
        <div class="stat-card">
          <div class="stat-icon file-icon">
            <el-icon><Files /></el-icon>
          </div>
          <div class="stat-content">
            <div class="stat-label">{{ $t('AdminMM.dashboard.stats.files') }}</div>
            <div class="stat-value">{{ dashboardData.overview.files.total }}</div>
            <div class="stat-detail">
              <span class="detail-item">{{ dashboardData.overview.files.totalSizeMB }} MB</span>
            </div>
          </div>
        </div>

        <!-- cNFT 统计 -->
        <div class="stat-card">
          <div class="stat-icon blockchain-icon">
            <el-icon><Coin /></el-icon>
          </div>
          <div class="stat-content">
            <div class="stat-label">{{ $t('AdminMM.dashboard.stats.cnfts') }}</div>
            <div class="stat-value">{{ dashboardData.overview.blockchain.cnfts.total }}</div>
            <div class="stat-detail">
              <span class="detail-item success">{{ dashboardData.overview.blockchain.cnfts.minted }} {{ $t('AdminMM.dashboard.stats.minted') }}</span>
              <span class="detail-item warning" v-if="dashboardData.overview.blockchain.cnfts.pending > 0">
                {{ dashboardData.overview.blockchain.cnfts.pending }} {{ $t('AdminMM.dashboard.stats.pending') }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 健康度指标 -->
      <div class="health-section">
        <div class="section-header">
          <h2 class="section-title">{{ $t('AdminMM.dashboard.health.title') }}</h2>
        </div>
        <div class="health-grid">
          <div class="health-item">
            <div class="health-label">{{ $t('AdminMM.dashboard.health.projectUtilization') }}</div>
            <div class="health-bar">
              <div class="health-progress" :style="{ width: dashboardData.health.projectUtilization + '%' }"></div>
            </div>
            <div class="health-value">{{ dashboardData.health.projectUtilization }}%</div>
          </div>
          <div class="health-item">
            <div class="health-label">{{ $t('AdminMM.dashboard.health.noteUtilization') }}</div>
            <div class="health-bar">
              <div class="health-progress" :style="{ width: dashboardData.health.noteUtilization + '%' }"></div>
            </div>
            <div class="health-value">{{ dashboardData.health.noteUtilization }}%</div>
          </div>
          <div class="health-item">
            <div class="health-label">{{ $t('AdminMM.dashboard.health.cnftSuccessRate') }}</div>
            <div class="health-bar">
              <div class="health-progress" :style="{ width: dashboardData.health.cnftSuccessRate + '%' }"></div>
            </div>
            <div class="health-value">{{ dashboardData.health.cnftSuccessRate }}%</div>
          </div>
        </div>
      </div>

      <!-- 最近活动 -->
      <div class="activity-section">
        <div class="activity-grid">
          <!-- 最近项目 -->
          <div class="activity-card">
            <div class="activity-header">
              <h3 class="activity-title">{{ $t('AdminMM.dashboard.recent.projects') }}</h3>
            </div>
            <div class="activity-list">
              <div v-for="item in dashboardData.recentActivity.projects" :key="item.id" class="activity-item">
                <div class="activity-item-main">
                  <div class="activity-item-title">{{ item.name }}</div>
                  <div class="activity-item-meta">
                    <el-tag v-if="item.status === 1" type="success" size="small">{{ $t('AdminMM.dashboard.status.active') }}</el-tag>
                    <el-tag v-else type="info" size="small">{{ $t('AdminMM.dashboard.status.inactive') }}</el-tag>
                    <span class="meta-text">{{ item.versionCount }} {{ $t('AdminMM.dashboard.stats.versions') }}</span>
                  </div>
                </div>
                <div class="activity-item-time">{{ formatTimeShort(item.createdAt) }}</div>
              </div>
              <div v-if="dashboardData.recentActivity.projects.length === 0" class="activity-empty">
                {{ $t('AdminMM.dashboard.messages.noData') }}
              </div>
            </div>
          </div>

          <!-- 最近笔记 -->
          <div class="activity-card">
            <div class="activity-header">
              <h3 class="activity-title">{{ $t('AdminMM.dashboard.recent.notes') }}</h3>
            </div>
            <div class="activity-list">
              <div v-for="item in dashboardData.recentActivity.notes" :key="item.id" class="activity-item">
                <div class="activity-item-main">
                  <div class="activity-item-title">{{ item.title }}</div>
                  <div class="activity-item-meta">
                    <span class="meta-text">{{ item.project }} / {{ item.category }}</span>
                  </div>
                </div>
                <div class="activity-item-time">{{ formatTimeShort(item.createdAt) }}</div>
              </div>
              <div v-if="dashboardData.recentActivity.notes.length === 0" class="activity-empty">
                {{ $t('AdminMM.dashboard.messages.noData') }}
              </div>
            </div>
          </div>
        </div>

        <!-- 文件类型分布 -->
        <div class="file-types-card">
          <div class="section-header">
            <h3 class="section-title">{{ $t('AdminMM.dashboard.files.typeDistribution') }}</h3>
          </div>
          <div class="file-types-list">
            <div v-for="item in dashboardData.overview.files.byType" :key="item.type" class="file-type-item">
              <div class="file-type-label">{{ item.type }}</div>
              <div class="file-type-stats">
                <span class="file-type-count">{{ item.count }} {{ $t('AdminMM.dashboard.files.files') }}</span>
                <span class="file-type-size">{{ item.sizeMB }} MB</span>
              </div>
            </div>
            <div v-if="dashboardData.overview.files.byType.length === 0" class="activity-empty">
              {{ $t('AdminMM.dashboard.messages.noData') }}
            </div>
          </div>
        </div>

        <!-- 最近会话 -->
        <div class="sessions-card">
          <div class="section-header">
            <h3 class="section-title">{{ $t('AdminMM.dashboard.recent.sessions') }}</h3>
          </div>
          <div class="sessions-list">
            <div v-for="item in dashboardData.recentActivity.sessions" :key="item.id" class="session-item">
              <div class="session-main">
                <div class="session-user">{{ item.username }}</div>
                <div class="session-meta">
                  <span class="meta-text">{{ item.ip }}</span>
                  <el-tag v-if="item.isActive" type="success" size="small">{{ $t('AdminMM.dashboard.status.active') }}</el-tag>
                  <el-tag v-else-if="item.isRevoked" type="danger" size="small">{{ $t('AdminMM.dashboard.status.revoked') }}</el-tag>
                  <el-tag v-else type="info" size="small">{{ $t('AdminMM.dashboard.status.expired') }}</el-tag>
                </div>
              </div>
              <div class="session-time">{{ formatTimeShort(item.createdAt) }}</div>
            </div>
            <div v-if="dashboardData.recentActivity.sessions.length === 0" class="activity-empty">
              {{ $t('AdminMM.dashboard.messages.noData') }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-container {
  --sloth-radius: 4px;
}

/* 页面头部 */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
  padding: 12px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
  backdrop-filter: blur(var(--sloth-blur));
}

.page-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--sloth-text);
  margin: 0 0 4px;
}

.page-desc {
  font-size: 13px;
  color: var(--sloth-text-subtle);
  margin: 0;
}

.header-right {
  display: flex;
  gap: 8px;
}

/* 加载状态 */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
}

.loading-container .el-icon {
  font-size: 32px;
  color: var(--sloth-primary);
  margin-bottom: 12px;
}

.loading-container p {
  color: var(--sloth-text-subtle);
  font-size: 13px;
}

/* 仪表盘内容 */
.dashboard-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 统计卡片网格 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
  backdrop-filter: blur(var(--sloth-blur));
  transition: all 0.2s;
}

.stat-card:hover {
  border-color: var(--sloth-primary);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.stat-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 24px;
  flex-shrink: 0;
}

.user-icon {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

.project-icon {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.category-icon {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}

.note-icon {
  background: rgba(139, 92, 246, 0.1);
  color: #8b5cf6;
}

.file-icon {
  background: rgba(236, 72, 153, 0.1);
  color: #ec4899;
}

.blockchain-icon {
  background: rgba(234, 179, 8, 0.1);
  color: #eab308;
}

.stat-content {
  flex: 1;
  min-width: 0;
}

.stat-label {
  font-size: 12px;
  color: var(--sloth-text-subtle);
  margin-bottom: 4px;
}

.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--sloth-text);
  margin-bottom: 4px;
}

.stat-detail {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
}

.detail-item {
  color: var(--sloth-text-subtle);
}

.detail-item.success {
  color: #10b981;
}

.detail-item.warning {
  color: #f59e0b;
}

/* 健康度部分 */
.health-section {
  padding: 16px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
  backdrop-filter: blur(var(--sloth-blur));
}

.section-header {
  margin-bottom: 16px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--sloth-text);
  margin: 0;
}

.health-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.health-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.health-label {
  font-size: 12px;
  color: var(--sloth-text-subtle);
}

.health-bar {
  height: 8px;
  background: var(--sloth-bg);
  border-radius: 4px;
  overflow: hidden;
}

.health-progress {
  height: 100%;
  background: linear-gradient(90deg, #10b981, #3b82f6);
  border-radius: 4px;
  transition: width 0.3s;
}

.health-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--sloth-text);
}

/* 活动部分 */
.activity-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.activity-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px;
}

.activity-card,
.file-types-card,
.sessions-card {
  padding: 16px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
  backdrop-filter: blur(var(--sloth-blur));
}

.activity-header {
  margin-bottom: 12px;
}

.activity-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--sloth-text);
  margin: 0;
}

.activity-list,
.file-types-list,
.sessions-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.activity-item,
.session-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px;
  background: var(--sloth-bg);
  border-radius: 4px;
  transition: background 0.2s;
}

.activity-item:hover,
.session-item:hover {
  background: var(--sloth-bg-hover);
}

.activity-item-main,
.session-main {
  flex: 1;
  min-width: 0;
}

.activity-item-title,
.session-user {
  font-size: 13px;
  color: var(--sloth-text);
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-item-meta,
.session-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.meta-text {
  color: var(--sloth-text-subtle);
}

.activity-item-time,
.session-time {
  font-size: 12px;
  color: var(--sloth-text-subtle);
  white-space: nowrap;
  margin-left: 8px;
}

.activity-empty {
  padding: 20px;
  text-align: center;
  color: var(--sloth-text-subtle);
  font-size: 12px;
}

/* 文件类型 */
.file-type-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px;
  background: var(--sloth-bg);
  border-radius: 4px;
}

.file-type-label {
  font-size: 13px;
  color: var(--sloth-text);
  font-weight: 500;
}

.file-type-stats {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--sloth-text-subtle);
}

/* Element Plus 样式覆盖 */
:deep(.el-button) {
  padding: 6px 12px;
  font-size: 13px;
  height: 30px;
}

:deep(.el-button--default) {
  --el-button-bg-color: var(--sloth-bg);
  --el-button-text-color: var(--sloth-text);
  --el-button-border-color: var(--sloth-card-border);
  --el-button-hover-bg-color: var(--sloth-bg-hover);
  --el-button-hover-text-color: var(--sloth-primary);
  --el-button-hover-border-color: var(--sloth-primary);
}

:deep(.el-tag) {
  padding: 0 6px;
  height: 20px;
  line-height: 20px;
  font-size: 11px;
}

:deep(.el-tag--success) {
  --el-tag-bg-color: rgba(16, 185, 129, 0.1);
  --el-tag-border-color: rgba(16, 185, 129, 0.2);
  --el-tag-text-color: #10b981;
}

:deep(.el-tag--info) {
  --el-tag-bg-color: var(--sloth-bg-hover);
  --el-tag-border-color: var(--sloth-card-border);
  --el-tag-text-color: var(--sloth-text-subtle);
}

:deep(.el-tag--danger) {
  --el-tag-bg-color: rgba(239, 68, 68, 0.1);
  --el-tag-border-color: rgba(239, 68, 68, 0.2);
  --el-tag-text-color: #ef4444;
}

/* 响应式 */
@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  }

  .stat-icon {
    width: 40px;
    height: 40px;
    font-size: 20px;
  }

  .stat-value {
    font-size: 20px;
  }

  .activity-grid {
    grid-template-columns: 1fr;
  }
}
</style>
