<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

definePageMeta({
  layout: 'project',
})

type ApiResponse<T> = {
  code: number
  message: string
  data: T
}

type ProjectHomeDto = {
  id: string
  projectId: string
  content: string
  updatedAt: string
}

const route = useRoute()
const projectId = computed(() => route.params.id as string)

const content = ref('')
const loading = ref(true)
const error = ref('')

async function fetchHome() {
  loading.value = true
  error.value = ''
  
  try {
    const res = await $fetch<ApiResponse<ProjectHomeDto>>(`/api/project/${projectId.value}/home`)
    
    if (res?.code === 0 && res.data) {
      content.value = res.data.content
    } else {
      error.value = res?.message || '加载失败'
    }
  } catch (e: any) {
    if (e?.data?.message) {
      error.value = e.data.message
    } else {
      error.value = '加载失败'
    }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchHome()
})
</script>

<template>
  <div class="project-home">
    <!-- 加载中 -->
    <div v-if="loading" class="loading-state">
      <div class="loading-spinner"></div>
      <span>加载中...</span>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="error-state">
      <div class="error-icon">⚠️</div>
      <p>{{ error }}</p>
    </div>

    <!-- 空内容 -->
    <div v-else-if="!content" class="empty-state">
      <div class="empty-icon">📄</div>
      <p>暂无内容</p>
    </div>

    <!-- 内容展示 -->
    <div v-else class="home-content">
      <ClientOnly>
        <MdEditorMdPreview
          :model-value="content"
          preview-theme="github"
          code-theme="github"
        />
        <template #fallback>
          <div class="loading-state">
            <div class="loading-spinner"></div>
            <span>加载中...</span>
          </div>
        </template>
      </ClientOnly>
    </div>
  </div>
</template>

<style scoped>
.project-home {
  width: 100vw;
  min-height: calc(100vh - 70px);
}

.home-content {
  width: 100%;
}

/* 加载状态 */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  color: var(--sloth-text-subtle);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--sloth-card-border);
  border-top-color: var(--sloth-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 错误状态 */
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  color: var(--sloth-text-subtle);
}

.error-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  color: var(--sloth-text-subtle);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

/* MdPreview 样式 - 移除背景和内边距 */
:deep(.md-editor-preview) {
  background: transparent !important;
  padding: 0 !important;
}

:deep(.md-editor-preview-wrapper) {
  padding: 0 !important;
}
</style>
