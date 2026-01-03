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

// 获取版本列表，跳转到第一个版本的文档页面
const { data: versionsData } = await useFetch<ApiResponse<VersionDto[]>>(
  () => `/api/project/${projectId.value}/versions`
)

const firstVersion = computed(() => {
  const versions = versionsData.value?.data ?? []
  return versions[0]
})

// 自动跳转到第一个版本的文档
if (firstVersion.value) {
  await navigateTo(
    `/project/${projectId.value}/v/${firstVersion.value.id}/docs`,
    { replace: true }
  )
}
</script>

<template>
  <div class="docs-empty">
    <div class="empty-icon">📄</div>
    <p>暂无可用版本</p>
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
