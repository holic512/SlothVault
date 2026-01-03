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

// 获取侧边栏数据，找到第一个笔记并跳转
const { data: sidebarData } = await useFetch<ApiResponse<CategoryDto[]>>(
  () => `/api/project/${projectId.value}/v/${versionId.value}/sidebar`
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

// 自动跳转到第一个笔记
if (firstNote.value) {
  await navigateTo(
    `/project/${projectId.value}/v/${versionId.value}/docs/${firstNote.value.id}`,
    { replace: true }
  )
}
</script>

<template>
  <div class="docs-empty">
    <div class="empty-icon">📄</div>
    <p>暂无文档内容</p>
  </div>
</template>

<style scoped>
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
