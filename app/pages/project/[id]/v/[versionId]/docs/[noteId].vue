<script setup lang="ts">
import { MdCatalog } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'

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

type NoteContentDto = {
  id: string
  noteId: string
  noteTitle: string
  content: string
  versionNote: string | null
  updatedAt: string
}

const route = useRoute()
const projectId = computed(() => route.params.id as string)
const versionId = computed(() => route.params.versionId as string)
const noteId = computed(() => route.params.noteId as string)

// 获取侧边栏数据
const { data: sidebarData } = await useFetch<ApiResponse<CategoryDto[]>>(
  () => `/api/project/${projectId.value}/v/${versionId.value}/sidebar`
)
const categories = computed(() => sidebarData.value?.data ?? [])

// 获取笔记内容
const { data: noteData, pending: loading, error: fetchError } = await useFetch<ApiResponse<NoteContentDto>>(
  () => `/api/project/${projectId.value}/v/${versionId.value}/note/${noteId.value}`,
  { watch: [noteId] }
)
const noteContent = computed(() => noteData.value?.data)
const error = computed(() => {
  if (fetchError.value) return '加载失败'
  if (noteData.value?.code !== 0) return noteData.value?.message || '加载失败'
  return ''
})

// MD 预览 ID（用于目录）
const mdPreviewId = 'doc-preview'

// 滚动状态
const scrollElement = ref<HTMLElement | null>(null)

onMounted(() => {
  scrollElement.value = document.documentElement
})
</script>

<template>
  <div class="docs-page">
    <!-- 左侧：分类和笔记目录 -->
    <aside class="docs-sidebar">
      <nav class="sidebar-nav">
        <div v-for="category in categories" :key="category.id" class="sidebar-category">
          <div class="category-title">{{ category.categoryName }}</div>
          <ul class="note-list">
            <li v-for="note in category.notes" :key="note.id">
              <NuxtLink
                :to="`/project/${projectId}/v/${versionId}/docs/${note.id}`"
                class="note-link"
                :class="{ 'is-active': note.id === noteId }"
              >
                {{ note.noteTitle }}
              </NuxtLink>
            </li>
          </ul>
        </div>
      </nav>
    </aside>

    <!-- 中间：内容区域 -->
    <main class="docs-content">
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

      <!-- 内容展示 -->
      <article v-else-if="noteContent" class="content-article">
        <div class="article-body">
          <ClientOnly>
            <MdEditorMdPreview
              :id="mdPreviewId"
              :model-value="noteContent.content"
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
      </article>

      <!-- 空内容 -->
      <div v-else class="empty-state">
        <div class="empty-icon">📄</div>
        <p>暂无内容</p>
      </div>
    </main>

    <!-- 右侧：文章目录 TOC -->
    <aside class="docs-toc">
      <div class="toc-title">目录</div>
      <MdCatalog
        v-if="noteContent?.content"
        :editor-id="mdPreviewId"
        :scroll-element="scrollElement"
        class="toc-catalog"
      />
      <div class="toc-divider"></div>
    </aside>
  </div>
</template>

<style scoped>
.docs-page {
  display: flex;
  min-height: calc(100vh - 60px);
}

/* 左侧侧边栏 */
.docs-sidebar {
  width: 200px;
  flex-shrink: 0;
  border-right: 1px solid var(--sloth-card-border);
  background: var(--sloth-card);
  overflow-y: auto;
  position: sticky;
  top: 60px;
  height: calc(100vh - 60px);
}

.sidebar-nav {
  padding: 16px 12px;
}

.sidebar-category {
  margin-bottom: 16px;
}

.category-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--sloth-text);
  padding: 6px 8px;
  margin-bottom: 4px;
}

.note-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.note-link {
  display: block;
  padding: 4px 8px 4px 16px;
  font-size: 0.8rem;
  color: var(--sloth-text-secondary);
  text-decoration: none;
  transition: color 0.2s;
}

.note-link:hover {
  color: var(--sloth-primary);
}

.note-link.is-active {
  color: var(--sloth-primary);
  font-weight: 500;
}

/* 中间内容区域 */
.docs-content {
  flex: 1;
  min-width: 0;
  padding: 32px 48px;
  margin-right: 220px;
}

.content-article {
  max-width: 1000px;
  margin: 0 auto;
}

.article-body {
  font-size: 1rem;
  line-height: 1.7;
  color: var(--sloth-text);
}

/* 右侧 TOC */
.docs-toc {
  width: 220px;
  flex-shrink: 0;
  border-left: 1px solid var(--sloth-card-border);
  background: var(--sloth-card);
  overflow-y: auto;
  position: fixed;
  right: 0;
  top: 60px;
  height: calc(100vh - 60px);
  padding: 20px 16px;
}

.toc-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--sloth-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
}

.toc-catalog {
  font-size: 0.85rem;
}

.toc-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--sloth-card-border), transparent);
  margin: 16px 0;
}

:deep(.md-editor-catalog-link) {
  color: var(--sloth-text-secondary);
  text-decoration: none;
  padding: 4px 0;
  display: block;
  transition: color 0.2s;
  background: none;
  border: none;
  cursor: pointer;
  font-size: inherit;
  text-align: left;
}

:deep(.md-editor-catalog-link:hover) {
  color: var(--sloth-primary);
  background: none;
}

:deep(.md-editor-catalog-active > .md-editor-catalog-link) {
  color: var(--sloth-primary);
  font-weight: 500;
  background: none;
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

/* 响应式 */
@media (max-width: 1200px) {
  .docs-toc {
    display: none;
  }

  .docs-content {
    margin-right: 0;
  }
}

@media (max-width: 768px) {
  .docs-sidebar {
    display: none;
  }

  .docs-content {
    padding: 20px;
  }

  .article-title {
    font-size: 1.5rem;
  }
}
</style>
