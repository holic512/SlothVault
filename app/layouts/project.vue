<script setup lang="ts">
import { ChevronDownIcon } from '@heroicons/vue/24/outline'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

// 获取项目ID
const projectId = computed(() => route.params.id as string)

// 获取当前版本ID（从路由中）
const currentVersionId = computed(() => route.params.versionId as string | undefined)

// 获取项目版本列表
const { data: versionsData } = await useFetch(() => `/api/project/${projectId.value}/versions`)
const versions = computed(() => versionsData.value?.data ?? [])

// 当前选中的版本
const selectedVersion = computed(() => {
  if (currentVersionId.value) {
    return versions.value.find((v: any) => v.id === currentVersionId.value)
  }
  return versions.value[0] // 默认第一个版本
})

// 版本选择下拉状态
const showVersionDropdown = ref(false)

function toggleVersionDropdown() {
  showVersionDropdown.value = !showVersionDropdown.value
}

function closeVersionDropdown() {
  showVersionDropdown.value = false
}

// 切换版本
function switchVersion(versionId: string) {
  closeVersionDropdown()
  // 如果当前在文档页面，切换到新版本的文档页面
  if (route.path.includes('/v/') && route.path.includes('/docs')) {
    router.push(`/project/${projectId.value}/v/${versionId}/docs`)
  }
}

// 是否显示版本选择器（只在文档相关页面显示）
const showVersionSelector = computed(() => {
  return route.path.includes('/v/') || route.name === 'project-id-docs'
})

// 处理站内链接，将相对路径转换为项目路径
function resolveMenuUrl(url: string | undefined): string {
  if (!url) return '#'
  // 如果是以 / 开头的站内链接，拼接项目前缀
  if (url.startsWith('/')) {
    return `/project/${projectId.value}${url}`
  }
  return url
}

// 获取项目详情
const { data: projectData } = await useFetch(() => `/api/project/${projectId.value}`)
const project = computed(() => projectData.value?.data)

// 获取项目菜单
const { data: menuData } = await useFetch(() => `/api/project/${projectId.value}/menu`)
const menus = computed(() => menuData.value?.data ?? [])

// 下拉菜单状态
const openMenuId = ref<string | null>(null)

function toggleDropdown(menuId: string) {
  openMenuId.value = openMenuId.value === menuId ? null : menuId
}

function closeDropdown() {
  openMenuId.value = null
}

// 外部链接确认弹窗
const showExternalDialog = ref(false)
const pendingExternalUrl = ref('')
const pendingExternalLabel = ref('')

function handleExternalLink(url: string, label: string) {
  pendingExternalUrl.value = url
  pendingExternalLabel.value = label
  showExternalDialog.value = true
  closeDropdown()
}

function confirmExternalLink() {
  if (pendingExternalUrl.value) {
    window.open(pendingExternalUrl.value, '_blank', 'noopener')
  }
  showExternalDialog.value = false
  pendingExternalUrl.value = ''
  pendingExternalLabel.value = ''
}

function cancelExternalLink() {
  showExternalDialog.value = false
  pendingExternalUrl.value = ''
  pendingExternalLabel.value = ''
}

// 点击外部关闭下拉
function handleClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.menu-dropdown')) {
    closeDropdown()
  }
  if (!target.closest('.version-selector')) {
    closeVersionDropdown()
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div class="project-layout">
    <!-- 顶部导航栏 -->
    <nav class="project-navbar">
      <div class="sloth-container navbar-inner">
        <!-- 左侧：项目头像和名称 + 版本选择器 -->
        <div class="navbar-left">
          <NuxtLink :to="`/project/${projectId}/home`" class="project-brand">
            <img 
              v-if="project?.avatar" 
              :src="project.avatar" 
              :alt="project?.projectName" 
              class="project-avatar"
            />
            <div v-else class="project-avatar-placeholder">
              {{ project?.projectName?.charAt(0) ?? 'P' }}
            </div>
            <span class="project-name">{{ project?.projectName ?? 'Loading...' }}</span>
          </NuxtLink>

          <!-- 版本选择器 -->
          <div 
            v-if="showVersionSelector && versions.length > 0" 
            class="version-selector"
            :class="{ 'is-open': showVersionDropdown }"
          >
            <button 
              class="version-btn"
              @click.stop="toggleVersionDropdown"
            >
              <span class="version-label">{{ selectedVersion?.version ?? '选择版本' }}</span>
              <ChevronDownIcon class="version-icon" />
            </button>
            <div v-show="showVersionDropdown" class="version-dropdown">
              <button
                v-for="ver in versions"
                :key="ver.id"
                class="version-item"
                :class="{ 'is-active': ver.id === selectedVersion?.id }"
                @click="switchVersion(ver.id)"
              >
                {{ ver.version }}
              </button>
            </div>
          </div>
        </div>

        <!-- 中间：菜单 -->
        <div class="navbar-center">
          <div class="nav-menus">
            <!-- 默认菜单：首页 -->
            <NuxtLink 
              :to="`/project/${projectId}/home`"
              class="nav-link"
            >
              首页
            </NuxtLink>
            <!-- 默认菜单：文档 -->
            <NuxtLink 
              :to="`/project/${projectId}/docs`"
              class="nav-link"
            >
              文档
            </NuxtLink>
            <!-- 自定义菜单 -->
            <template v-for="menu in menus" :key="menu.id">
              <!-- 有子菜单 -->
              <div 
                v-if="menu.children?.length" 
                class="menu-dropdown"
                :class="{ 'is-open': openMenuId === menu.id }"
              >
                <button 
                  class="nav-menu-btn"
                  @click.stop="toggleDropdown(menu.id)"
                >
                  {{ menu.label }}
                  <ChevronDownIcon class="dropdown-icon" />
                </button>
                <div v-show="openMenuId === menu.id" class="dropdown-panel">
                  <template v-for="child in menu.children" :key="child.id">
                    <a 
                      v-if="child.isExternal"
                      href="javascript:void(0)"
                      class="dropdown-item"
                      @click="handleExternalLink(child.url, child.label)"
                    >
                      {{ child.label }}
                    </a>
                    <NuxtLink 
                      v-else
                      :to="resolveMenuUrl(child.url)"
                      class="dropdown-item"
                      @click="closeDropdown"
                    >
                      {{ child.label }}
                    </NuxtLink>
                  </template>
                </div>
              </div>
              <!-- 无子菜单 -->
              <template v-else>
                <a 
                  v-if="menu.isExternal"
                  href="javascript:void(0)"
                  class="nav-link"
                  @click="handleExternalLink(menu.url, menu.label)"
                >
                  {{ menu.label }}
                </a>
                <NuxtLink 
                  v-else
                  :to="resolveMenuUrl(menu.url)"
                  class="nav-link"
                >
                  {{ menu.label }}
                </NuxtLink>
              </template>
            </template>
          </div>
        </div>

        <!-- 右侧：工具按钮 -->
        <div class="navbar-right">
          <ProjectListButton />
          <ThemeToggle />
        </div>
      </div>
    </nav>

    <!-- 内容区域 -->
    <main class="project-content">
      <slot />
    </main>

    <!-- 外部链接确认弹窗 -->
    <div v-if="showExternalDialog" class="external-dialog-overlay" @click.self="cancelExternalLink">
      <div class="external-dialog">
        <div class="external-dialog-header">
          <h3>即将离开本站</h3>
        </div>
        <div class="external-dialog-body">
          <p>您即将访问外部链接：</p>
          <p class="external-url">{{ pendingExternalUrl }}</p>
          <p class="external-tip">请注意外部网站的安全性，是否继续？</p>
        </div>
        <div class="external-dialog-footer">
          <button class="btn-cancel" @click="cancelExternalLink">取消</button>
          <button class="btn-confirm" @click="confirmExternalLink">继续访问</button>
        </div>
      </div>
    </div>
  </div>
</template>


<style scoped>
.project-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--sloth-bg);
  background-image: none;
}

/* 导航栏 */
.project-navbar {
  position: sticky;
  top: 0;
  z-index: 50;
  height: 60px;
  background: var(--sloth-card);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--sloth-card-border);
}

.navbar-inner {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 100%;
}

/* 左侧：项目信息 */
.navbar-left {
  display: flex;
  align-items: center;
}

.project-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: var(--sloth-text);
  transition: opacity 0.2s;
}

.project-brand:hover {
  opacity: 0.8;
}

.project-avatar {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  object-fit: cover;
}

.project-avatar-placeholder {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--sloth-primary-dim);
  color: var(--sloth-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.8rem;
}

.project-name {
  font-weight: 500;
  font-size: 1rem;
}

/* 版本选择器 */
.version-selector {
  position: relative;
  margin-left: 16px;
  padding-left: 16px;
  border-left: 1px solid var(--sloth-card-border);
}

.version-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--sloth-text-secondary);
  background: var(--sloth-bg-hover);
  border: 1px solid var(--sloth-card-border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.version-btn:hover {
  color: var(--sloth-primary);
  border-color: var(--sloth-primary);
}

.version-icon {
  width: 14px;
  height: 14px;
  transition: transform 0.2s;
}

.version-selector.is-open .version-icon {
  transform: rotate(180deg);
}

.version-dropdown {
  position: absolute;
  top: 100%;
  left: 16px;
  min-width: 120px;
  margin-top: 6px;
  padding: 6px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  z-index: 60;
}

.version-item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  font-size: 0.85rem;
  color: var(--sloth-text);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s;
}

.version-item:hover {
  color: var(--sloth-primary);
  background: var(--sloth-bg-hover);
}

.version-item.is-active {
  color: var(--sloth-primary);
  background: var(--sloth-primary-dim);
}

/* 中间：菜单 */
.navbar-center {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
}

.nav-menus {
  display: flex;
  align-items: center;
  gap: 4px;
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

/* 下拉菜单 */
.menu-dropdown {
  position: relative;
}

.nav-menu-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 16px;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--sloth-text);
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.nav-menu-btn:hover {
  color: var(--sloth-primary);
  background: var(--sloth-bg-hover);
}

.dropdown-icon {
  width: 14px;
  height: 14px;
  transition: transform 0.2s;
}

.menu-dropdown.is-open .dropdown-icon {
  transform: rotate(180deg);
}

.dropdown-panel {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 160px;
  margin-top: 4px;
  padding: 6px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
}

.dropdown-item {
  display: block;
  padding: 8px 12px;
  font-size: 0.875rem;
  color: var(--sloth-text);
  text-decoration: none;
  border-radius: 6px;
  transition: all 0.2s;
}

.dropdown-item:hover {
  color: var(--sloth-primary);
  background: var(--sloth-bg-hover);
}

/* 右侧：工具按钮 */
.navbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-icon {
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tool-icon {
  width: 20px;
  height: 20px;
}

/* 内容区域 */
.project-content {
  flex: 1;
}

/* 移动端适配 */
@media (max-width: 768px) {
  .navbar-center {
    display: none;
  }

  .project-name {
    font-size: 1rem;
  }
}

/* 外部链接确认弹窗 */
.external-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.external-dialog {
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: 12px;
  width: 90%;
  max-width: 420px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
}

.external-dialog-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--sloth-card-border);
}

.external-dialog-header h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--sloth-text);
}

.external-dialog-body {
  padding: 20px;
}

.external-dialog-body p {
  margin: 0 0 8px;
  color: var(--sloth-text-secondary);
  font-size: 0.9rem;
}

.external-url {
  word-break: break-all;
  color: var(--sloth-primary) !important;
  font-weight: 500;
  padding: 10px;
  background: var(--sloth-bg-hover);
  border-radius: 6px;
  margin: 12px 0 !important;
}

.external-tip {
  color: var(--sloth-text-tertiary) !important;
  font-size: 0.85rem !important;
}

.external-dialog-footer {
  padding: 16px 20px;
  border-top: 1px solid var(--sloth-card-border);
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-cancel,
.btn-confirm {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel {
  background: transparent;
  border: 1px solid var(--sloth-card-border);
  color: var(--sloth-text-secondary);
}

.btn-cancel:hover {
  background: var(--sloth-bg-hover);
}

.btn-confirm {
  background: var(--sloth-primary);
  border: none;
  color: white;
}

.btn-confirm:hover {
  opacity: 0.9;
}
</style>
