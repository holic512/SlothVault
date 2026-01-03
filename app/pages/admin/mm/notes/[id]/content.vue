<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { ElButton, ElMessage, ElTag, ElMessageBox, ElDialog, ElForm, ElFormItem, ElInput } from 'element-plus'
import { PlusIcon, StarIcon, TrashIcon } from '@heroicons/vue/24/outline'
import { StarIcon as StarIconSolid } from '@heroicons/vue/24/solid'

definePageMeta({
  layout: 'admin-mm',
})

type ApiResponse<T> = {
  code: number
  message: string
  data: T
}

type NoteInfoDto = {
  id: string
  categoryId: string
  noteTitle: string
  weight: number
  status: number
  category?: {
    id: string
    categoryName: string
    projectVersion?: {
      id: string
      version: string
      project?: {
        id: string
        projectName: string
      } | null
    } | null
  } | null
}

type NoteContentDto = {
  id: string
  noteInfoId: string
  content: string
  versionNote: string | null
  isPrimary: boolean
  status: number
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

const route = useRoute()
const router = useRouter()

const noteInfoId = computed(() => route.params.id as string)
const noteInfo = ref<NoteInfoDto | null>(null)
const contentList = ref<NoteContentDto[]>([])
const selectedContentId = ref<string | null>(null)
const content = ref('')
const savedContent = ref('')
const loading = ref(false)
const saving = ref(false)
const autoSaveTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const lastSaveTime = ref<Date | null>(null)

// 新建版本弹窗
const newVersionDialogOpen = ref(false)
const newVersionNote = ref('')
const newVersionSubmitting = ref(false)

const selectedContent = computed(() => 
  contentList.value.find(c => c.id === selectedContentId.value) || null
)

const hasUnsavedChanges = computed(() => content.value !== savedContent.value)

// 获取笔记路径显示
const notePath = computed(() => {
  const parts: string[] = []
  if (noteInfo.value?.category?.projectVersion?.project?.projectName) {
    parts.push(noteInfo.value.category.projectVersion.project.projectName)
  }
  if (noteInfo.value?.category?.projectVersion?.version) {
    parts.push(noteInfo.value.category.projectVersion.version)
  }
  if (noteInfo.value?.category?.categoryName) {
    parts.push(noteInfo.value.category.categoryName)
  }
  return parts.join(' / ')
})

async function apiFetch<T>(url: string, options?: any): Promise<T> {
  const res = await $fetch<ApiResponse<T>>(url, options)
  if (res?.code === 0) return res.data
  if (res?.code === 401) {
    await router.push('/admin/auth/login')
    throw new Error('Unauthorized')
  }
  throw new Error(res?.message || '请求失败')
}

// 获取笔记信息
async function fetchNoteInfo() {
  try {
    const data = await apiFetch<{list: NoteInfoDto[]}>(`/api/admin/mm/note`, {
      method: 'GET',
      query: { pageSize: 1 },
    })
    // 通过ID单独获取
    const res = await $fetch<ApiResponse<NoteInfoDto>>(`/api/admin/mm/note/${noteInfoId.value}`, {
      method: 'GET',
    })
    if (res?.code === 0) {
      noteInfo.value = res.data
    }
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error('获取笔记信息失败')
    }
  }
}

// 获取内容版本列表
async function fetchContentList() {
  loading.value = true
  try {
    const data = await apiFetch<{list: NoteContentDto[]}>(`/api/admin/mm/noteContent`, {
      method: 'GET',
      query: { noteInfoId: noteInfoId.value },
    })
    contentList.value = data.list

    // 如果没有选中的版本，自动选中主版本或第一个
    if (!selectedContentId.value || !data.list.find(c => c.id === selectedContentId.value)) {
      const primary = data.list.find(c => c.isPrimary)
      if (primary) {
        selectContent(primary)
      } else if (data.list.length > 0) {
        selectContent(data.list[0])
      } else {
        selectedContentId.value = null
        content.value = ''
        savedContent.value = ''
      }
    }
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '加载失败')
    }
  } finally {
    loading.value = false
  }
}

// 选中内容版本
function selectContent(item: NoteContentDto) {
  // 如果有未保存的更改，提示用户
  if (hasUnsavedChanges.value && selectedContentId.value) {
    ElMessageBox.confirm('当前版本有未保存的更改，是否放弃？', '提示', {
      confirmButtonText: '放弃',
      cancelButtonText: '取消',
      type: 'warning',
    }).then(() => {
      doSelectContent(item)
    }).catch(() => {})
  } else {
    doSelectContent(item)
  }
}

function doSelectContent(item: NoteContentDto) {
  selectedContentId.value = item.id
  content.value = item.content
  savedContent.value = item.content
  lastSaveTime.value = null
}

// 保存内容
async function saveContent(silent = false) {
  if (saving.value || !selectedContentId.value) return
  if (!hasUnsavedChanges.value) {
    if (!silent) ElMessage.info('内容无变化')
    return
  }
  
  saving.value = true
  try {
    const data = await apiFetch<NoteContentDto>(`/api/admin/mm/noteContent/${selectedContentId.value}`, {
      method: 'PUT',
      body: { content: content.value },
    })
    
    // 更新列表中的数据
    const idx = contentList.value.findIndex(c => c.id === data.id)
    if (idx !== -1) {
      contentList.value[idx] = data
    }
    
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

// 自动保存
function scheduleAutoSave() {
  if (autoSaveTimer.value) {
    clearTimeout(autoSaveTimer.value)
  }
  autoSaveTimer.value = setTimeout(() => {
    if (hasUnsavedChanges.value) {
      saveContent(true)
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
    saveContent()
  }
}

// 新建版本
function openNewVersionDialog() {
  newVersionNote.value = ''
  newVersionDialogOpen.value = true
}

async function createNewVersion() {
  newVersionSubmitting.value = true
  try {
    const data = await apiFetch<NoteContentDto>('/api/admin/mm/noteContent', {
      method: 'POST',
      body: {
        noteInfoId: noteInfoId.value,
        content: '',
        versionNote: newVersionNote.value || null,
        status: 1,
      },
    })
    
    newVersionDialogOpen.value = false
    await fetchContentList()
    selectContent(data)
    ElMessage.success('创建成功')
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '创建失败')
    }
  } finally {
    newVersionSubmitting.value = false
  }
}

// 设为主版本
async function setPrimary(item: NoteContentDto) {
  if (item.isPrimary) return
  
  try {
    await apiFetch<NoteContentDto>(`/api/admin/mm/noteContent/${item.id}`, {
      method: 'PUT',
      body: { isPrimary: true },
    })
    await fetchContentList()
    ElMessage.success('已设为主版本')
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '操作失败')
    }
  }
}

// 删除版本
async function deleteVersion(item: NoteContentDto) {
  try {
    await ElMessageBox.confirm(
      `确认删除版本「${item.versionNote || '未命名'}」？`,
      '提示',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
    
    await apiFetch(`/api/admin/mm/noteContent/${item.id}`, { method: 'DELETE' })
    
    // 如果删除的是当前选中的版本，清空选中
    if (selectedContentId.value === item.id) {
      selectedContentId.value = null
      content.value = ''
      savedContent.value = ''
    }
    
    await fetchContentList()
    ElMessage.success('已删除')
  } catch (e: any) {
    if (e?.message && e.message !== 'cancel' && e.message !== 'close' && e.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '删除失败')
    }
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

function formatTime(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleString('zh-CN', { 
    month: '2-digit', 
    day: '2-digit', 
    hour: '2-digit', 
    minute: '2-digit' 
  })
}

function formatSaveTime(date: Date | null) {
  if (!date) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

onMounted(() => {
  fetchNoteInfo()
  fetchContentList()
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
  <div class="note-content-page">
    <!-- 左侧版本列表 -->
    <aside class="version-sidebar">
      <div class="sidebar-header">
        <h3 class="sidebar-title">内容版本</h3>
        <el-button type="primary" size="small" @click="openNewVersionDialog">
          <PlusIcon class="btn-icon" />
          新建
        </el-button>
      </div>
      
      <div class="version-list" v-loading="loading">
        <div 
          v-for="item in contentList" 
          :key="item.id"
          class="version-item"
          :class="{ 'is-active': selectedContentId === item.id, 'is-primary': item.isPrimary }"
          @click="selectContent(item)"
        >
          <div class="version-info">
            <div class="version-name">
              <StarIconSolid v-if="item.isPrimary" class="primary-icon" />
              <span>{{ item.versionNote || '未命名版本' }}</span>
            </div>
            <div class="version-time">{{ formatTime(item.updatedAt) }}</div>
          </div>
          <div class="version-actions" @click.stop>
            <button 
              v-if="!item.isPrimary" 
              class="action-btn" 
              title="设为主版本"
              @click="setPrimary(item)"
            >
              <StarIcon class="action-icon" />
            </button>
            <button 
              class="action-btn action-delete" 
              title="删除"
              @click="deleteVersion(item)"
            >
              <TrashIcon class="action-icon" />
            </button>
          </div>
        </div>
        
        <div v-if="contentList.length === 0 && !loading" class="empty-tip">
          暂无内容版本，点击上方按钮创建
        </div>
      </div>
    </aside>

    <!-- 右侧编辑区 -->
    <main class="editor-main">
      <!-- 工具栏 -->
      <div class="toolbar">
        <div class="toolbar-left">
          <span v-if="noteInfo" class="note-title">{{ noteInfo.noteTitle }}</span>
          <span v-if="notePath" class="note-path">{{ notePath }}</span>
          <el-tag v-if="hasUnsavedChanges" type="warning" size="small">未保存</el-tag>
          <el-tag v-else-if="lastSaveTime" type="success" size="small">
            已保存 {{ formatSaveTime(lastSaveTime) }}
          </el-tag>
        </div>
        <div class="toolbar-right">
          <span class="save-hint">Ctrl+S 保存</span>
          <el-button type="primary" :loading="saving" :disabled="!selectedContentId" @click="saveContent(false)">
            保存
          </el-button>
        </div>
      </div>

      <!-- 编辑器 -->
      <div class="editor-container">
        <template v-if="selectedContentId">
          <MdEditor
            v-model="content"
            preview-theme="github"
            code-theme="github"
            @upload-img="handleUploadImg"
          />
        </template>
        <div v-else class="no-content">
          <p>请从左侧选择或创建一个内容版本</p>
        </div>
      </div>
    </main>

    <!-- 新建版本弹窗 -->
    <el-dialog
      v-model="newVersionDialogOpen"
      title="新建内容版本"
      width="400px"
      :close-on-click-modal="false"
    >
      <el-form label-width="80px">
        <el-form-item label="版本备注">
          <el-input 
            v-model="newVersionNote" 
            placeholder="可选，如：初稿、修订版等"
            maxlength="255"
            show-word-limit
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="newVersionDialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="newVersionSubmitting" @click="createNewVersion">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>


<style scoped>
.note-content-page {
  display: flex;
  height: 100%;
  gap: 0;
}

/* 左侧版本列表 */
.version-sidebar {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-right: none;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid var(--sloth-card-border);
}

.sidebar-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--sloth-text);
}

.version-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.version-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  margin-bottom: 4px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  background: transparent;
}

.version-item:hover {
  background: var(--sloth-bg-hover);
}

.version-item.is-active {
  background: var(--sloth-primary-dim);
}

.version-item.is-primary .version-name {
  color: var(--sloth-primary);
}

.version-info {
  flex: 1;
  min-width: 0;
}

.version-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--sloth-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.primary-icon {
  width: 14px;
  height: 14px;
  color: var(--sloth-primary);
  flex-shrink: 0;
}

.version-time {
  font-size: 11px;
  color: var(--sloth-text-subtle);
  margin-top: 2px;
}

.version-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.version-item:hover .version-actions {
  opacity: 1;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--sloth-text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:hover {
  background: var(--sloth-bg-hover);
  color: var(--sloth-primary);
}

.action-btn.action-delete:hover {
  color: #ef4444;
}

.action-icon {
  width: 14px;
  height: 14px;
}

.empty-tip {
  text-align: center;
  padding: 20px;
  color: var(--sloth-text-subtle);
  font-size: 13px;
}

/* 右侧编辑区 */
.editor-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

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

.note-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--sloth-primary);
}

.note-path {
  font-size: 12px;
  color: var(--sloth-text-subtle);
}

.save-hint {
  font-size: 12px;
  color: var(--sloth-text-subtle);
}

.editor-container {
  flex: 1;
  display: flex;
  min-height: 0;
  border: 1px solid var(--sloth-card-border);
  overflow: hidden;
}

.no-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--sloth-card);
  color: var(--sloth-text-subtle);
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

:deep(.el-button--small) {
  padding: 4px 10px;
  font-size: 12px;
  height: 26px;
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

.btn-icon {
  width: 14px;
  height: 14px;
  margin-right: 4px;
}

/* Dialog 适配 */
:deep(.el-dialog) {
  --el-dialog-bg-color: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
}

:deep(.el-dialog__header) {
  padding: 12px 16px;
  border-bottom: 1px solid var(--sloth-card-border);
}

:deep(.el-dialog__title) {
  font-size: 15px;
  font-weight: 600;
  color: var(--sloth-text);
}

:deep(.el-dialog__body) {
  padding: 16px;
}

:deep(.el-dialog__footer) {
  padding: 10px 16px;
  border-top: 1px solid var(--sloth-card-border);
}

:deep(.el-form-item__label) {
  font-size: 13px;
  color: var(--sloth-text);
}

:deep(.el-input__wrapper) {
  background-color: var(--sloth-bg);
  box-shadow: 0 0 0 1px var(--sloth-card-border) inset;
}

:deep(.el-input__inner) {
  color: var(--sloth-text);
}
</style>
