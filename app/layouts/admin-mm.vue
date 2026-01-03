<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import ThemeToggle from '~/components/ThemeToggle.vue'
import { HomeIcon, RectangleStackIcon, Bars3Icon, ChevronRightIcon, FolderIcon, DocumentIcon } from '@heroicons/vue/24/outline'

const { t } = useI18n()
const route = useRoute()

const isCollapse = ref(false)
const activeMenu = computed(() => route.path)

// 面包屑映射逻辑
const breadcrumbMap: Record<string, string> = {
  '/admin/mm': 'AdminMM.menu.dashboard',
  '/admin/mm/projects': 'AdminMM.menu.projects',
  '/admin/mm/categories': 'AdminMM.menu.categories',
  '/admin/mm/files': 'AdminMM.menu.files'
}

const breadcrumbs = computed(() => {
  const path = route.path
  const currentKey = breadcrumbMap[path]
  
  const items = [
    { name: t('AdminMM.title'), path: '/admin/mm', disabled: true } // 根节点
  ]
  
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
        </transition>
        <button class="collapse-btn" @click="toggleSidebar" :title="isCollapse ? 'Expand' : 'Collapse'">
          <Bars3Icon class="icon-size" />
        </button>
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

        <el-menu-item index="/admin/mm/files">
          <el-icon><DocumentIcon /></el-icon>
          <span>{{ t('AdminMM.menu.files') }}</span>
        </el-menu-item>
      </el-menu>
    </aside>

    <!-- Main Content -->
    <div class="main-wrapper">
      <header class="admin-header">
        <div class="header-left">
          <nav class="breadcrumb-nav" aria-label="Breadcrumb">
            <ol class="breadcrumb-list">
              <li v-for="(item, index) in breadcrumbs" :key="item.path" class="breadcrumb-item">
                <span v-if="index > 0" class="breadcrumb-separator">
                  <ChevronRightIcon class="separator-icon" />
                </span>
                <span 
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
          <NuxtLink to="/" class="home-link" title="返回主页">
            <HomeIcon class="home-icon" />
          </NuxtLink>
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
.admin-layout {
  display: flex;
  min-height: 100vh;
  background: transparent;
  color: var(--sloth-text);
  transition: color 0.3s ease;
}

.admin-sidebar {
  width: 200px;
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
  width: 64px;
}

.logo-area {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  font-weight: 600;
  font-size: 15px;
  color: var(--sloth-primary);
  border-bottom: 1px solid var(--sloth-card-border);
  overflow: hidden;
}

.admin-sidebar.is-collapsed .logo-area {
  justify-content: center;
  padding: 0 8px;
}

.logo-text {
  white-space: nowrap;
}

.collapse-btn {
  background: transparent;
  border: none;
  color: var(--sloth-text-secondary, inherit);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
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
  padding-top: 6px;
  overflow-x: hidden;
}

/* Element Plus Menu Overrides for Theme */
:deep(.el-menu) {
  background-color: transparent;
  border-right: none;
}

:deep(.el-menu-item) {
  color: var(--sloth-text);
  margin: 2px 8px;
  border-radius: 6px;
  height: 36px;
  line-height: 36px;
  font-size: 13px;
}

.admin-sidebar.is-collapsed :deep(.el-menu-item) {
  margin: 2px 8px;
  border-radius: 4px;
  justify-content: center;
  padding: 0 !important;
}

.admin-sidebar.is-collapsed :deep(.el-menu) {
  width: 100% !important;
}

.admin-sidebar.is-collapsed :deep(.el-menu--collapse) {
  width: 100% !important;
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

:deep(.el-icon) {
  font-size: 16px;
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

.home-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  color: var(--sloth-text-secondary);
  transition: all 0.2s;
}

.home-link:hover {
  background-color: var(--sloth-bg-hover);
  color: var(--sloth-primary);
}

.home-icon {
  width: 18px;
  height: 18px;
}
</style>
