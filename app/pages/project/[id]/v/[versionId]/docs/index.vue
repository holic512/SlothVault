<script setup lang="ts">
definePageMeta({
  layout: 'project',
})

type ApiResponse<T> = {
  code: number
  message: string
  data: T
}

type NoteDto = {
  id: string
  noteTitle: string
  weight: number
}

type CategoryDto = {
  id: string
  categoryName: string
  weight: number
  notes: NoteDto[]
}

const route = useRoute()
const projectId = computed(() => route.params.id as string)
const versionId = computed(() => route.params.versionId as string)
const walletStore = useWalletStore()

// 使用项目鉴权
const {
  isLoading: authLoading,
  hasAccess,
  requireAuth,
  getAuthQuery,
} = useProjectAuth(projectId)

// 获取侧边栏数据，找到第一个笔记并跳转
const { data: sidebarData, error: fetchError } = await useFetch<ApiResponse<CategoryDto[]>>(
  () => `/api/project/${projectId.value}/v/${versionId.value}/sidebar`,
  {
    query: computed(() => getAuthQuery()),
    watch: [() => walletStore.publicKey],
  }
)

// 找到第一个笔记并跳转
const firstNote = computed(() => {
  const categories = sidebarData.value?.data ?? []
  for (const cat of categories) {
    if (cat.notes?.length > 0) {
      return cat.notes[0]
    }
  }
  return null
})

// 监听鉴权状态和笔记数据变化，自动跳转
watch(
  [hasAccess, firstNote],
  ([access, note]) => {
    if (access && note) {
      navigateTo(
        `/project/${projectId.value}/v/${versionId.value}/docs/${note.id}`,
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
        <p>暂无文档内容</p>
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
