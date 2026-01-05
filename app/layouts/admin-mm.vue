<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import ThemeToggle from '~/components/ThemeToggle.vue'
import { HomeIcon, RectangleStackIcon, ChevronRightIcon, ChevronDoubleLeftIcon, ChevronDoubleRightIcon, FolderIcon, DocumentIcon, DocumentTextIcon, CubeTransparentIcon } from '@heroicons/vue/24/outline'
import HomeButton from '~/components/admin/mm/layout/HomeButton.vue'

const { t } = useI18n()
const route = useRoute()

const isCollapse = ref(false)
const activeMenu = computed(() => route.path)

// 面包屑映射逻辑
const breadcrumbMap: Record<string, string> = {
  '/admin/mm': 'AdminMM.menu.dashboard',
  '/admin/mm/projects': 'AdminMM.menu.projects',
  '/admin/mm/categories': 'AdminMM.menu.categories',
  '/admin/mm/notes': 'AdminMM.menu.notes',
  '/admin/mm/files': 'AdminMM.menu.files',
  '/admin/mm/solana': 'AdminMM.menu.solana'
}

const breadcrumbs = computed(() => {
  const path = route.path
  const currentKey = breadcrumbMap[path]
  
  const items = [
    { name: t('AdminMM.title'), path: '/admin/mm', disabled: true } // 根节点
  ]
  
  // 检查是否是项目首页编辑页面
  const homeEditMatch = path.match(/^\/admin\/mm\/projects\/(\d+)\/home$/)
  if (homeEditMatch) {
    items.push({ name: t('AdminMM.menu.projects'), path: '/admin/mm/projects', disabled: false })
    items.push({ name: t('AdminMM.breadcrumb.homeEdit'), path, disabled: true })
    return items
  }

  // 检查是否是笔记内容编辑页面
  const noteContentMatch = path.match(/^\/admin\/mm\/notes\/(\d+)\/content$/)
  if (noteContentMatch) {
    items.push({ name: t('AdminMM.menu.notes'), path: '/admin/mm/notes', disabled: false })
    items.push({ name: t('AdminMM.breadcrumb.contentEdit'), path, disabled: true })
    return items
  }
  
  if (currentKey) {
    // 简单匹配：如果是仪表盘，就不需要重复显示了，或者作为第二级
    if (path !== '/admin/mm') {
       items.push({ name: t(currentKey), path, disabled: true })
    } else {
       items.push({ name: t('AdminMM.menu.dashboard'), path, disabled: true })
    }
  } else {
    // Fallback: 如果不在 map 里，简单展示路径最后一截 (首字母大写)
    const segments = path.split('/').filter(Boolean)
    const last = segments[segments.length - 1]
    if (last) {
       items.push({ name: last.charAt(0).toUpperCase() + last.slice(1), path, disabled: true })
    }
  }
  return items
})

const toggleSidebar = () => {
  isCollapse.value = !isCollapse.value
}
</script>

<template>
  <div class="admin-layout">
    <!-- Sidebar -->
    <aside class="admin-sidebar" :class="{ 'is-collapsed': isCollapse }">
      <div class="logo-area">
        <transition name="fade">
          <span v-if="!isCollapse" class="logo-text">{{ t('AdminMM.title') }}</span>
          <span v-else class="logo-icon">MM</span>
        </transition>
      </div>
      
      <el-menu
        :default-active="activeMenu"
        class="admin-menu"
        router
        :collapse="isCollapse"
      >
        <el-menu-item index="/admin/mm">
          <el-icon><HomeIcon /></el-icon>
          <span>{{ t('AdminMM.menu.dashboard') }}</span>
        </el-menu-item>
        
        <el-menu-item index="/admin/mm/projects">
          <el-icon><RectangleStackIcon /></el-icon>
          <span>{{ t('AdminMM.menu.projects') }}</span>
        </el-menu-item>

        <el-menu-item index="/admin/mm/categories">
          <el-icon><FolderIcon /></el-icon>
          <span>{{ t('AdminMM.menu.categories') }}</span>
        </el-menu-item>

        <el-menu-item index="/admin/mm/notes">
          <el-icon><DocumentTextIcon /></el-icon>
          <span>{{ t('AdminMM.menu.notes') }}</span>
        </el-menu-item>

        <el-menu-item index="/admin/mm/files">
          <el-icon><DocumentIcon /></el-icon>
          <span>{{ t('AdminMM.menu.files') }}</span>
        </el-menu-item>

        <el-menu-item index="/admin/mm/solana">
          <el-icon><CubeTransparentIcon /></el-icon>
          <span>{{ t('AdminMM.menu.solana') }}</span>
        </el-menu-item>
      </el-menu>
    </aside>

    <!-- Main Content -->
    <div class="main-wrapper">
      <header class="admin-header">
        <div class="header-left">
          <button class="collapse-btn" @click="toggleSidebar" :title="isCollapse ? t('AdminMM.sidebar.expand') : t('AdminMM.sidebar.collapse')">
            <ChevronDoubleRightIcon v-if="isCollapse" class="icon-size" />
            <ChevronDoubleLeftIcon v-else class="icon-size" />
          </button>
          <nav class="breadcrumb-nav" aria-label="Breadcrumb">
            <ol class="breadcrumb-list">
              <li v-for="(item, index) in breadcrumbs" :key="item.path" class="breadcrumb-item">
                <span v-if="index > 0" class="breadcrumb-separator">
                  <ChevronRightIcon class="separator-icon" />
                </span>
                <NuxtLink 
                v-if="!item.disabled"
                :to="item.path"
                class="breadcrumb-link"
              >
                {{ item.name }}
              </NuxtLink>
              <span 
                v-else
                class="breadcrumb-link" 
                :class="{ 'is-current': index === breadcrumbs.length - 1 }"
                :aria-current="index === breadcrumbs.length - 1 ? 'page' : undefined"
              >
                {{ item.name }}
              </span>
              </li>
            </ol>
          </nav>
        </div>
        <div class="header-right">
          <WalletConnector />
          <HomeButton />
          <ThemeToggle />
        </div>
      </header>
      
      <main class="admin-content">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
/* CSS 变量统一管理侧边栏尺寸 */
.admin-layout {
  --sidebar-width: 180px;
  --sidebar-collapsed-width: 56px;
  --menu-item-height: 38px;
  --menu-icon-size: 18px;
  
  display: flex;
  min-height: 100vh;
  background: transparent;
  color: var(--sloth-text);
  transition: color 0.3s ease;
}

.admin-sidebar {
  width: var(--sidebar-width);
  min-width: var(--sidebar-collapsed-width);
  background-color: var(--sloth-card);
  border-right: 1px solid var(--sloth-card-border);
  display: flex;
  flex-direction: column;
  backdrop-filter: blur(var(--sloth-blur));
  flex-shrink: 0;
  z-index: 10;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

.admin-sidebar.is-collapsed {
  width: var(--sidebar-collapsed-width);
}

.logo-area {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  font-weight: 600;
  font-size: 14px;
  color: var(--sloth-primary);
  border-bottom: 1px solid var(--sloth-card-border);
  overflow: hidden;
  white-space: nowrap;
}

.admin-sidebar.is-collapsed .logo-area {
  padding: 0;
}

.logo-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.logo-icon {
  font-size: 13px;
  font-weight: 700;
}

.collapse-btn {
  background: transparent;
  border: none;
  color: var(--sloth-text-secondary, inherit);
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  margin-right: 8px;
  flex-shrink: 0;
}

.collapse-btn:hover {
  background-color: var(--sloth-bg-hover);
  color: var(--sloth-primary);
}

.icon-size {
  width: 18px;
  height: 18px;
}

.admin-menu {
  border-right: none;
  background: transparent;
  flex: 1;
  padding: 6px 0;
  overflow-x: hidden;
  overflow-y: auto;
}

/* Element Plus Menu Overrides for Theme */
:deep(.el-menu) {
  background-color: transparent;
  border-right: none;
}

:deep(.el-menu-item) {
  color: var(--sloth-text);
  margin: 2px 6px;
  border-radius: 6px;
  height: var(--menu-item-height);
  line-height: var(--menu-item-height);
  font-size: 13px;
  padding: 0 12px !important;
  transition: all 0.2s ease;
}

/* 菜单项文字溢出处理 */
:deep(.el-menu-item span) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

/* 折叠状态下的菜单项 */
.admin-sidebar.is-collapsed :deep(.el-menu-item) {
  margin: 2px 6px;
  border-radius: 6px;
  justify-content: center;
  padding: 0 !important;
  width: calc(var(--sidebar-collapsed-width) - 12px);
}

.admin-sidebar.is-collapsed :deep(.el-menu-item span) {
  display: none;
}

.admin-sidebar.is-collapsed :deep(.el-menu) {
  width: 100% !important;
}

.admin-sidebar.is-collapsed :deep(.el-menu--collapse) {
  width: 100% !important;
}

/* 图标样式优化 */
:deep(.el-menu-item .el-icon) {
  font-size: var(--menu-icon-size);
  width: var(--menu-icon-size);
  height: var(--menu-icon-size);
  margin-right: 8px;
  flex-shrink: 0;
}

.admin-sidebar.is-collapsed :deep(.el-menu-item .el-icon) {
  margin-right: 0;
}

:deep(.el-menu-item:hover), :deep(.el-menu-item:focus) {
  background-color: var(--sloth-bg-hover);
  color: var(--sloth-primary);
}

:deep(.el-menu-item.is-active) {
  background-color: var(--sloth-primary-dim);
  color: var(--sloth-primary);
  font-weight: 600;
}

/* Transition for logo text */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  display: none;
}

.main-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  position: relative;
}

.admin-header {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background-color: var(--sloth-card);
  border-bottom: 1px solid var(--sloth-card-border);
  backdrop-filter: blur(var(--sloth-blur));
  position: sticky;
  top: 0;
  z-index: 9;
}

.admin-content {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  background: transparent;
}

/* Breadcrumb Styles */
.header-left {
  display: flex;
  align-items: center;
  height: 100%;
}

.breadcrumb-nav {
  margin-top: 4px;
  display: flex;
  align-items: center;
  height: 100%;
}

.breadcrumb-list {
  display: flex;
  align-items: center;
  list-style: none;
  margin: 0;
  padding: 0;
}

.breadcrumb-item {
  display: flex;
  align-items: center;
  font-size: 13px;
  color: var(--sloth-text-secondary);
}

.breadcrumb-separator {
  margin: 0 6px;
  display: flex;
  align-items: center;
  color: var(--sloth-text-tertiary, #9ca3af);
}

.separator-icon {
  width: 12px;
  height: 12px;
}

.breadcrumb-link {
  transition: color 0.2s;
  font-weight: 500;
  text-decoration: none;
  color: var(--sloth-text-secondary);
}

.breadcrumb-link:hover:not(.is-current) {
  color: var(--sloth-primary);
}

.breadcrumb-link.is-current {
  color: var(--sloth-text);
  font-weight: 600;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
