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
  background: linear-gradient(to bottom, #fafafa 0%, #ffffff 100%);
}

.dark .homepage-wrapper {
  background: linear-gradient(to bottom, #000000 0%, #0a0a0a 100%);
}

.loading-state,
.error-state {
  text-align: center;
  padding: 80px 24px;
  color: #86868b;
}

.loading-state p,
.error-state p {
  font-size: 15px;
  line-height: 1.52941;
  font-weight: 400;
  letter-spacing: -0.022em;
  margin: 0;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  margin: 0 auto 20px;
  border: 2.5px solid rgba(0, 0, 0, 0.08);
  border-top-color: #0071e3;
  border-radius: 50%;
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

.error-state p {
  color: #d70015;
}

.dark .error-state p {
  color: #ff453a;
}

/* 响应式适配 */
@media (max-width: 768px) {
  .homepage-wrapper {
    padding: 80px 0 40px;
  }

  .loading-state,
  .error-state {
    padding: 60px 20px;
  }

  .loading-spinner {
    width: 28px;
    height: 28px;
  }
}
</style>
