<script setup>
import { ref, onMounted } from 'vue'

const { t } = useI18n()
const { setPageTitle } = usePageTitle()

// 设置页面标题
setPageTitle('home')

const homepageContent = ref('')
const loading = ref(true)
const error = ref(false)

// 获取系统首页内容
async function fetchHomepage() {
  loading.value = true
  error.value = false
  try {
    const res = await $fetch('/api/homepage')
    if (res?.code === 0 && res.data?.content) {
      homepageContent.value = res.data.content
    } else {
      error.value = true
    }
  } catch (e) {
    console.error('Failed to fetch homepage:', e)
    error.value = true
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchHomepage()
})
</script>

<template>
  <!-- 液态玻璃悬浮导航栏 -->
  <LiquidNavbar />

  <!-- 首页内容区域 -->
  <div class="homepage-wrapper">
    <div class="sloth-container">
      <!-- 加载状态 -->
      <div v-if="loading" class="loading-state">
        <div class="loading-spinner"></div>
        <p>{{ t('ProjectsPage.loading') }}</p>
      </div>

      <!-- 错误状态 -->
      <div v-else-if="error" class="error-state">
        <p>{{ t('ProjectsPage.error') }}</p>
      </div>

      <!-- Markdown 内容展示 - 使用 ClientOnly 包裹 -->
      <ClientOnly v-else>
        <MdEditorMdPreview :model-value="homepageContent" />
        <template #fallback>
          <div class="loading-state">
            <div class="loading-spinner"></div>
            <p>{{ t('ProjectsPage.loading') }}</p>
          </div>
        </template>
      </ClientOnly>
    </div>
  </div>
</template>

<style scoped>
.homepage-wrapper {
  padding: 100px 0 60px;
  min-height: 100vh;
}

.loading-state,
.error-state {
  text-align: center;
  padding: 60px 24px;
  color: var(--sloth-text-subtle);
}

.loading-spinner {
  width: 40px;
  height: 40px;
  margin: 0 auto 16px;
  border: 3px solid var(--sloth-card-border);
  border-top-color: var(--sloth-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-state p {
  color: var(--sloth-error, #ef4444);
}

/* 响应式适配 */
@media (max-width: 768px) {
  .homepage-wrapper {
    padding: 80px 0 40px;
  }
}
</style>
