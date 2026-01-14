<script setup lang="ts">
definePageMeta({
  layout: 'project',
})

type ApiResponse<T> = {
  code: number
  message: string
  data: T
}

type VersionDto = {
  id: string
  version: string
  description: string | null
  weight: number
}

const route = useRoute()
const projectId = computed(() => route.params.id as string)
const walletStore = useWalletStore()

// 使用项目鉴权
const {
  isLoading: authLoading,
  hasAccess,
  requireAuth,
  getAuthQuery,
} = useProjectAuth(projectId)

// 获取版本列表，跳转到第一个版本的文档页面
const { data: versionsData, error: fetchError } = await useFetch<ApiResponse<VersionDto[]>>(
  () => `/api/project/${projectId.value}/versions`,
  {
    query: computed(() => getAuthQuery()),
    watch: [() => walletStore.publicKey],
  }
)

const firstVersion = computed(() => {
  const versions = versionsData.value?.data ?? []
  return versions[0]
})

// 监听鉴权状态和版本数据变化，自动跳转
watch(
  [hasAccess, firstVersion],
  ([access, version]) => {
    if (access && version) {
      navigateTo(
        `/project/${projectId.value}/v/${version.id}/docs`,
        { replace: true }
      )
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="docs-page-wrapper">
    <!-- 鉴权守卫 -->
    <ProjectAuthGuard
      :project-id="projectId"
      :show-loading="true"
    >
      <div class="docs-empty">
        <div class="empty-icon">📄</div>
        <p>暂无可用版本</p>
      </div>
    </ProjectAuthGuard>
  </div>
</template>

<style scoped>
.docs-page-wrapper {
  min-height: calc(100vh - 70px);
}

.docs-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 70px);
  color: var(--sloth-text-subtle);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}
</style>
