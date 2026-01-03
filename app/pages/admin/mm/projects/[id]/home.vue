<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { ElButton, ElMessage, ElTag } from 'element-plus'

definePageMeta({
  layout: 'admin-mm',
})

type ApiResponse<T> = {
  code: number
  message: string
  data: T
}

type ProjectDto = {
  id: string
  projectName: string
}

type ProjectHomeDto = {
  id: string
  projectId: string
  content: string
  status: number
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

const route = useRoute()
const router = useRouter()

const projectId = computed(() => route.params.id as string)
const project = ref<ProjectDto | null>(null)
const homeData = ref<ProjectHomeDto | null>(null)
const content = ref('')
const savedContent = ref('')
const loading = ref(false)
const saving = ref(false)
const autoSaveTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const lastSaveTime = ref<Date | null>(null)

const hasUnsavedChanges = computed(() => content.value !== savedContent.value)

async function apiFetch<T>(url: string, options?: any): Promise<T> {
  const res = await $fetch<ApiResponse<T>>(url, options)
  if (res?.code === 0) return res.data
  if (res?.code === 401) {
    await router.push('/admin/auth/login')
    throw new Error('Unauthorized')
  }
  throw new Error(res?.message || '请求失败')
}

// 获取项目信息
async function fetchProject() {
  try {
    const data = await apiFetch<ProjectDto>(`/api/admin/mm/project/${projectId.value}`, {
      method: 'GET',
    })
    project.value = data
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error('获取项目信息失败')
    }
  }
}

// 获取或自动创建首页内容
async function fetchOrCreateHome() {
  loading.value = true
  try {
    // 先尝试获取
    const data = await apiFetch<ProjectHomeDto>(`/api/admin/mm/home?projectId=${projectId.value}`, {
      method: 'GET',
    })
    homeData.value = data
    content.value = data.content
    savedContent.value = data.content
  } catch (e: any) {
    if (e?.message === 'Not Found' || e?.message?.includes('404')) {
      // 不存在则自动创建
      try {
        const data = await apiFetch<ProjectHomeDto>('/api/admin/mm/home', {
          method: 'POST',
          body: {
            projectId: projectId.value,
            content: '',
            status: 1,
          },
        })
        homeData.value = data
        content.value = ''
        savedContent.value = ''
      } catch (createErr: any) {
        if (createErr?.message !== 'Unauthorized') {
          ElMessage.error('创建首页失败')
        }
      }
    } else if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '加载失败')
    }
  } finally {
    loading.value = false
  }
}

// 保存首页内容
async function saveHome(silent = false) {
  if (saving.value || !homeData.value) return
  if (!hasUnsavedChanges.value) {
    if (!silent) ElMessage.info('内容无变化')
    return
  }
  
  saving.value = true
  try {
    const data = await apiFetch<ProjectHomeDto>(`/api/admin/mm/home/${homeData.value.id}`, {
      method: 'PUT',
      body: {
        content: content.value,
      },
    })
    homeData.value = data
    savedContent.value = content.value
    lastSaveTime.value = new Date()
    if (!silent) ElMessage.success('保存成功')
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '保存失败')
    }
  } finally {
    saving.value = false
  }
}

// 自动保存（延迟 3 秒）
function scheduleAutoSave() {
  if (autoSaveTimer.value) {
    clearTimeout(autoSaveTimer.value)
  }
  autoSaveTimer.value = setTimeout(() => {
    if (hasUnsavedChanges.value) {
      saveHome(true)
    }
  }, 3000)
}

watch(content, () => {
  scheduleAutoSave()
})

// 快捷键保存
function handleKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    saveHome()
  }
}

// 处理图片上传
async function handleUploadImg(files: File[], callback: (urls: string[]) => void) {
  try {
    const urls: string[] = []
    for (const file of files) {
      const formData = new FormData()
      formData.append('file', file)
      
      const res = await $fetch<ApiResponse<Array<{ url: string }>>>('/api/admin/mm/file?businessType=Markdown', {
        method: 'POST',
        body: formData,
      })
      
      if (res?.code === 0 && res.data?.[0]?.url) {
        urls.push(res.data[0].url)
      }
    }
    callback(urls)
  } catch (e: any) {
    ElMessage.error('图片上传失败')
    callback([])
  }
}

function formatSaveTime(date: Date | null) {
  if (!date) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

onMounted(() => {
  fetchProject()
  fetchOrCreateHome()
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  if (autoSaveTimer.value) {
    clearTimeout(autoSaveTimer.value)
  }
})
</script>

<template>
  <div class="home-editor-page">
    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <span v-if="project" class="project-name">{{ project.projectName }}</span>
        <el-tag v-if="hasUnsavedChanges" type="warning" size="small">未保存</el-tag>
        <el-tag v-else-if="lastSaveTime" type="success" size="small">
          已保存 {{ formatSaveTime(lastSaveTime) }}
        </el-tag>
      </div>
      <div class="toolbar-right">
        <span class="save-hint">Ctrl+S 保存</span>
        <el-button type="primary" :loading="saving" @click="saveHome(false)">保存</el-button>
      </div>
    </div>

    <!-- 编辑器区域 -->
    <div class="editor-container" v-loading="loading">
      <MdEditor
        v-model="content"
        preview-theme="github"
        code-theme="github"
        @upload-img="handleUploadImg"
      />
    </div>
  </div>
</template>

<style scoped>
.home-editor-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 0;
}

/* 工具栏 */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-bottom: none;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.project-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--sloth-primary);
}

.save-hint {
  font-size: 12px;
  color: var(--sloth-text-subtle);
}

/* 编辑器容器 */
.editor-container {
  flex: 1;
  display: flex;
  min-height: 0;
  border: 1px solid var(--sloth-card-border);
  overflow: hidden;
}

/* MdEditor 样式覆盖 */
:deep(.md-editor) {
  width: 100%;
  height: 100% !important;
  border: none !important;
}

:deep(.md-editor-content) {
  height: 100% !important;
}

/* Element Plus 适配 */
:deep(.el-button) {
  padding: 6px 12px;
  font-size: 13px;
  height: 30px;
}

:deep(.el-button--primary) {
  --el-button-bg-color: var(--sloth-primary);
  --el-button-border-color: var(--sloth-primary);
  --el-button-hover-bg-color: var(--sloth-primary-hover);
  --el-button-hover-border-color: var(--sloth-primary-hover);
}

:deep(.el-button--default) {
  --el-button-bg-color: var(--sloth-bg);
  --el-button-text-color: var(--sloth-text);
  --el-button-border-color: var(--sloth-card-border);
  --el-button-hover-bg-color: var(--sloth-bg-hover);
  --el-button-hover-text-color: var(--sloth-primary);
  --el-button-hover-border-color: var(--sloth-primary);
}
</style>
