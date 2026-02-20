<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { ElButton, ElDropdown, ElDropdownItem, ElDropdownMenu, ElMessage, ElTag, ElMessageBox, ElDialog, ElForm, ElFormItem, ElInput, ElTooltip } from 'element-plus'
import { ArrowPathIcon, EllipsisHorizontalIcon, PencilSquareIcon, PlusIcon, TagIcon } from '@heroicons/vue/24/outline'
import NoteNavTreePanel, { type NavTreeNode, type ProjectVersionDto as NavProjectVersionDto } from '~/components/admin/mm/notes/NoteNavTreePanel.vue'
import NoteVersionsPanel from '~/components/admin/mm/notes/NoteVersionsPanel.vue'
import EditNoteDialog from '~/components/admin/mm/notes/EditNoteDialog.vue'
import EditCategoryDialog from '~/components/admin/mm/notes/EditCategoryDialog.vue'
import CreateNoteDialog, { type CategoryDto as CreateNoteCategoryDto } from '~/components/admin/mm/notes/CreateNoteDialog.vue'

definePageMeta({
  layout: 'admin-mm',
})

const { t } = useI18n()
const { setPageTitle } = usePageTitle()

// 设置页面标题
setPageTitle('adminNoteContent')

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

type ProjectVersionDto = {
  id: string
  projectId: string
  version: string
  project?: {
    id: string
    projectName: string
  } | null
}

type CategoryDto = {
  id: string
  projectVersionId: string
  categoryName: string
  weight?: number
  status?: number
  isDeleted?: boolean
}

type NoteNavDto = {
  id: string
  categoryId: string
  noteTitle: string
  weight: number
  status: number
  isDeleted: boolean
  contentCount: number
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

// 左侧分类/笔记树
const projectVersions = ref<ProjectVersionDto[]>([])
const navProjectVersionId = ref('')
const navTreeKeyword = ref('')
const navTreeLoading = ref(false)
const navTreeData = ref<NavTreeNode[]>([])
const navCategories = ref<CategoryDto[]>([])

// 停留时间
const staySeconds = ref(0)
const stayTimer = ref<ReturnType<typeof setInterval> | null>(null)

// 菜单弹窗
const editNoteDialogOpen = ref(false)
const editCategoryDialogOpen = ref(false)
const editCategoryTargetId = ref('')
const createNoteDialogOpen = ref(false)
const createNoteDefaultCategoryId = ref('')
const pendingOpen = ref<null | { type: 'editNote' | 'createNote'; noteId: string }>(null)

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

const currentTreeKey = computed(() => `note-${noteInfoId.value}`)

const stayTimeText = computed(() => {
  const s = staySeconds.value
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`
})

async function apiFetch<T>(url: string, options?: any): Promise<T> {
  const res = await $fetch<ApiResponse<T>>(url, options)
  if (res?.code === 0) return res.data
  if (res?.code === 401) {
    await router.push('/admin/auth/login')
    throw new Error('Unauthorized')
  }
  throw new Error(res?.message || t('AdminMM.notes.messages.requestFailed'))
}

// 获取笔记信息
async function fetchNoteInfo() {
  try {
    // 通过ID单独获取
    const res = await $fetch<ApiResponse<NoteInfoDto>>(`/api/admin/mm/note/${noteInfoId.value}`, {
      method: 'GET',
    })
    if (res?.code === 0) {
      noteInfo.value = res.data
    }
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(t('AdminMM.notes.content.messages.fetchNoteFailed'))
    }
  }
}

async function fetchProjectVersions() {
  try {
    const all: ProjectVersionDto[] = []
    for (let page = 1; page <= 20; page++) {
      const data = await apiFetch<{list: ProjectVersionDto[]; page: number; pageSize: number; total: number}>(`/api/admin/mm/projectVersion`, {
        method: 'GET',
        query: { page, pageSize: 100, includeProject: '1' },
      })
      all.push(...(data.list || []))
      if (!data.list?.length || all.length >= data.total) break
    }
    projectVersions.value = all
  } catch {
    projectVersions.value = []
  }
}

async function fetchAllNotesByProjectVersion(projectVersionId: string) {
  const all: NoteNavDto[] = []
  for (let page = 1; page <= 50; page++) {
    const data = await apiFetch<{list: NoteNavDto[]; page: number; pageSize: number; total: number}>(`/api/admin/mm/note`, {
      method: 'GET',
      query: { page, pageSize: 100, projectVersionId },
    })
    all.push(...(data.list || []))
    if (!data.list?.length || all.length >= data.total) break
  }
  return all
}

function buildNavTree(categories: CategoryDto[], notes: NoteNavDto[]): NavTreeNode[] {
  const categoryNodes = new Map<string, NavTreeNode>()
  for (const cat of categories) {
    categoryNodes.set(cat.id, {
      id: `cat-${cat.id}`,
      type: 'category',
      label: cat.categoryName,
      categoryId: cat.id,
      weight: cat.weight ?? 0,
      noteCount: 0,
      children: [],
    })
  }

  for (const note of notes) {
    const parent = categoryNodes.get(note.categoryId)
    if (!parent) continue
    parent.children!.push({
      id: `note-${note.id}`,
      type: 'note',
      label: note.noteTitle,
      noteId: note.id,
      categoryId: note.categoryId,
      weight: note.weight,
      contentCount: note.contentCount,
    })
    parent.noteCount = (parent.noteCount || 0) + 1
  }

  const result = Array.from(categoryNodes.values())
  for (const node of result) {
    node.children = (node.children || []).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.label.localeCompare(b.label, 'zh-CN'))
  }
  return result
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || a.label.localeCompare(b.label, 'zh-CN'))
    .filter((n) => (n.children?.length ?? 0) > 0 || n.label)
}

async function refreshNavTree(projectVersionId: string) {
  if (!projectVersionId) {
    navTreeData.value = []
    navCategories.value = []
    return
  }
  navTreeLoading.value = true
  try {
    const catData = await apiFetch<{list: CategoryDto[]}>(`/api/admin/mm/category/byProjectVersion/${projectVersionId}`, {
      method: 'GET',
      query: { pageSize: 100 },
    })
    navCategories.value = catData.list || []
    const notes = await fetchAllNotesByProjectVersion(projectVersionId)
    navTreeData.value = buildNavTree(catData.list || [], notes)
    await nextTick()
  } catch {
    navTreeData.value = []
    navCategories.value = []
  } finally {
    navTreeLoading.value = false
  }
}

function confirmDiscardIfNeeded() {
  if (!hasUnsavedChanges.value || !selectedContentId.value) return Promise.resolve(true)
  return ElMessageBox.confirm(
    t('AdminMM.notes.content.messages.unsavedConfirm'),
    t('AdminMM.notes.content.messages.unsavedConfirmTitle'),
    {
      confirmButtonText: t('AdminMM.notes.content.messages.discardButton'),
      cancelButtonText: t('AdminMM.notes.content.messages.cancelButton'),
      type: 'warning',
    }
  )
    .then(() => true)
    .catch(() => false)
}

async function handleNavNodeClick(data: NavTreeNode) {
  if (data.type !== 'note' || !data.noteId) return
  if (data.noteId === noteInfoId.value) return
  const ok = await confirmDiscardIfNeeded()
  if (!ok) return
  await router.push(`/admin/mm/notes/${data.noteId}/content`)
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
      ElMessage.error(e?.message || t('AdminMM.notes.content.messages.loadFailed'))
    }
  } finally {
    loading.value = false
  }
}

// 选中内容版本
function selectContent(item: NoteContentDto) {
  // 如果有未保存的更改，提示用户
  if (hasUnsavedChanges.value && selectedContentId.value) {
    confirmDiscardIfNeeded().then((ok) => {
      if (ok) doSelectContent(item)
    })
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
    if (!silent) ElMessage.info(t('AdminMM.notes.content.messages.noChanges'))
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
    if (!silent) ElMessage.success(t('AdminMM.notes.content.messages.saveSuccess'))
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || t('AdminMM.notes.content.messages.saveFailed'))
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

watch(navProjectVersionId, (val) => {
  refreshNavTree(val)
})

function startStayTimer() {
  staySeconds.value = 0
  if (stayTimer.value) clearInterval(stayTimer.value)
  stayTimer.value = setInterval(() => {
    staySeconds.value += 1
  }, 1000)
}

function stopStayTimer() {
  if (stayTimer.value) clearInterval(stayTimer.value)
  stayTimer.value = null
}

async function refreshAll() {
  await Promise.all([
    fetchProjectVersions(),
    fetchNoteInfo(),
    fetchContentList(),
    navProjectVersionId.value ? refreshNavTree(navProjectVersionId.value) : Promise.resolve(),
  ])
}

function getCategoryEditModel(categoryId: string | null | undefined) {
  if (!categoryId) return null
  const c = navCategories.value.find((x) => x.id === categoryId)
  if (!c) return null
  return {
    id: c.id,
    categoryName: c.categoryName,
    weight: c.weight ?? 0,
    status: c.status ?? 1,
  }
}

async function saveNoteBaseInfo(payload: { noteTitle: string; weight: number; status: number }) {
  if (!noteInfo.value) return
  try {
    await apiFetch(`/api/admin/mm/note/${noteInfo.value.id}`, {
      method: 'PUT',
      body: payload,
    })
    editNoteDialogOpen.value = false
    await fetchNoteInfo()
    await refreshNavTree(navProjectVersionId.value)
    ElMessage.success(t('AdminMM.notes.messages.saveSuccess'))
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || t('AdminMM.notes.messages.submitFailed'))
    }
  }
}

async function saveCategoryBaseInfo(payload: { categoryName: string; weight: number; status: number }) {
  const categoryId = editCategoryTargetId.value || noteInfo.value?.categoryId
  if (!categoryId) return
  try {
    await apiFetch(`/api/admin/mm/category/${categoryId}`, {
      method: 'PUT',
      body: payload,
    })
    editCategoryDialogOpen.value = false
    editCategoryTargetId.value = ''
    await fetchNoteInfo()
    await refreshNavTree(navProjectVersionId.value)
    ElMessage.success(t('AdminMM.categories.messages.saveSuccess'))
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || t('AdminMM.categories.messages.submitFailed'))
    }
  }
}

async function createNote(payload: { categoryId: string; noteTitle: string; weight: number; status: number }) {
  try {
    const data = await apiFetch<{ id: string }>('/api/admin/mm/note', {
      method: 'POST',
      body: payload,
    })
    createNoteDialogOpen.value = false
    await refreshNavTree(navProjectVersionId.value)
    await router.push(`/admin/mm/notes/${data.id}/content`)
    ElMessage.success(t('AdminMM.notes.messages.createSuccess'))
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || t('AdminMM.notes.messages.submitFailed'))
    }
  }
}

async function handleNavMenu(payload: { command: string; node?: NavTreeNode }) {
  const command = payload.command
  const node = payload.node

  if (command === 'refresh') {
    await refreshNavTree(navProjectVersionId.value)
    return
  }

  if (command === 'editCategory') {
    const targetCategoryId = node?.type === 'category' ? node.categoryId : noteInfo.value?.categoryId
    if (!targetCategoryId) return
    const model = getCategoryEditModel(targetCategoryId)
    if (!model) return
    editCategoryTargetId.value = targetCategoryId
    editCategoryDialogOpen.value = true
    return
  }

  if (command === 'createNote') {
    createNoteDefaultCategoryId.value = node?.type === 'category' ? (node.categoryId || '') : (noteInfo.value?.categoryId || '')
    createNoteDialogOpen.value = true
    return
  }

  if (command === 'editNote' && node?.type === 'note' && node.noteId) {
    if (node.noteId !== noteInfoId.value) {
      const ok = await confirmDiscardIfNeeded()
      if (!ok) return
      pendingOpen.value = { type: 'editNote', noteId: node.noteId }
      await router.push(`/admin/mm/notes/${node.noteId}/content`)
      return
    }
    editNoteDialogOpen.value = true
  }
}

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
    ElMessage.success(t('AdminMM.notes.content.messages.createSuccess'))
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || t('AdminMM.notes.content.messages.createFailed'))
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
    ElMessage.success(t('AdminMM.notes.content.messages.setPrimarySuccess'))
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || t('AdminMM.notes.content.messages.operationFailed'))
    }
  }
}

// 删除版本
async function deleteVersion(item: NoteContentDto) {
  try {
    await ElMessageBox.confirm(
      t('AdminMM.notes.content.messages.deleteConfirm', { name: item.versionNote || t('AdminMM.notes.content.unnamedVersion') }),
      t('AdminMM.notes.content.messages.deleteConfirmTitle'),
      { 
        confirmButtonText: t('AdminMM.notes.content.messages.deleteButton'), 
        cancelButtonText: t('AdminMM.notes.content.messages.cancelButton'), 
        type: 'warning' 
      }
    )
    
    await apiFetch(`/api/admin/mm/noteContent/${item.id}`, { method: 'DELETE' })
    
    // 如果删除的是当前选中的版本，清空选中
    if (selectedContentId.value === item.id) {
      selectedContentId.value = null
      content.value = ''
      savedContent.value = ''
    }
    
    await fetchContentList()
    ElMessage.success(t('AdminMM.notes.content.messages.deleted'))
  } catch (e: any) {
    if (e?.message && e.message !== 'cancel' && e.message !== 'close' && e.message !== 'Unauthorized') {
      ElMessage.error(e?.message || t('AdminMM.notes.content.messages.deleteFailed'))
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
    ElMessage.error(t('AdminMM.notes.content.messages.uploadFailed'))
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
  fetchProjectVersions()
  startStayTimer()
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  if (autoSaveTimer.value) {
    clearTimeout(autoSaveTimer.value)
  }
  stopStayTimer()
})

watch(
  noteInfoId,
  async () => {
    if (autoSaveTimer.value) {
      clearTimeout(autoSaveTimer.value)
      autoSaveTimer.value = null
    }
    selectedContentId.value = null
    content.value = ''
    savedContent.value = ''
    contentList.value = []
    lastSaveTime.value = null
    staySeconds.value = 0

    await fetchNoteInfo()
    await fetchContentList()

    const pvId = noteInfo.value?.category?.projectVersion?.id
    if (pvId) {
      navProjectVersionId.value = pvId
    }

    await nextTick()
    if (pendingOpen.value && pendingOpen.value.noteId === noteInfoId.value) {
      const action = pendingOpen.value
      pendingOpen.value = null
      if (action.type === 'editNote') editNoteDialogOpen.value = true
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="note-content-page">
    <!-- 左侧：分类/笔记树 + 内容版本 -->
    <aside class="left-sidebar">
      <NoteNavTreePanel
        v-model="navProjectVersionId"
        v-model:keyword="navTreeKeyword"
        :project-versions="(projectVersions as unknown as NavProjectVersionDto[])"
        :loading="navTreeLoading"
        :tree-data="(navTreeData as unknown as NavTreeNode[])"
        :current-key="currentTreeKey"
        @refresh="refreshNavTree(navProjectVersionId)"
        @node-click="handleNavNodeClick"
        @menu="handleNavMenu"
      />

      <NoteVersionsPanel
        :loading="loading"
        :content-list="contentList"
        :selected-content-id="selectedContentId"
        :format-time="formatTime"
        @refresh="fetchContentList"
        @new-version="openNewVersionDialog"
        @select="selectContent"
        @set-primary="setPrimary"
        @delete="deleteVersion"
      />
    </aside>

    <!-- 右侧编辑区 -->
    <main class="editor-main">
      <!-- 工具栏 -->
      <div class="toolbar">
        <div class="toolbar-left">
          <span v-if="noteInfo" class="note-title">{{ noteInfo.noteTitle }}</span>
          <span v-if="notePath" class="note-path">{{ notePath }}</span>
          <el-tooltip :content="$t('AdminMM.notes.content.stayTimeTip')" placement="bottom">
            <span class="stay-time">
              <TagIcon class="stay-icon" />
              {{ $t('AdminMM.notes.content.stayTime') }} {{ stayTimeText }}
            </span>
          </el-tooltip>
          <el-tag v-if="hasUnsavedChanges" type="warning" size="small">{{ $t('AdminMM.notes.content.unsaved') }}</el-tag>
          <el-tag v-else-if="lastSaveTime" type="success" size="small">
            {{ $t('AdminMM.notes.content.saved') }} {{ formatSaveTime(lastSaveTime) }}
          </el-tag>
        </div>
        <div class="toolbar-right">
          <span class="save-hint">{{ $t('AdminMM.notes.content.saveHint') }}</span>
          <el-button text class="icon-btn" :title="$t('AdminMM.notes.content.actions.refresh')" @click="refreshAll">
            <ArrowPathIcon class="icon" />
          </el-button>
          <el-dropdown trigger="click">
            <el-button text class="icon-btn" :title="$t('AdminMM.notes.content.actions.more')">
              <EllipsisHorizontalIcon class="icon" />
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="editNoteDialogOpen = true">
                  <PencilSquareIcon class="menu-icon" />
                  {{ $t('AdminMM.notes.content.actions.editNote') }}
                </el-dropdown-item>
                <el-dropdown-item @click="editCategoryTargetId = noteInfo?.categoryId || ''; editCategoryDialogOpen = true">
                  <PencilSquareIcon class="menu-icon" />
                  {{ $t('AdminMM.notes.content.actions.editCategory') }}
                </el-dropdown-item>
                <el-dropdown-item
                  @click="
                    createNoteDefaultCategoryId = noteInfo?.categoryId || '';
                    createNoteDialogOpen = true
                  "
                >
                  <PlusIcon class="menu-icon" />
                  {{ $t('AdminMM.notes.content.actions.createNote') }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button type="primary" :loading="saving" :disabled="!selectedContentId" @click="saveContent(false)">
            {{ $t('AdminMM.notes.content.save') }}
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
          <p>{{ $t('AdminMM.notes.content.selectOrCreate') }}</p>
        </div>
      </div>
    </main>

    <!-- 新建版本弹窗 -->
    <el-dialog
      v-model="newVersionDialogOpen"
      :title="$t('AdminMM.notes.content.newVersionDialog.title')"
      width="400px"
      :close-on-click-modal="false"
    >
      <el-form label-width="80px">
        <el-form-item :label="$t('AdminMM.notes.content.newVersionDialog.versionNote')">
          <el-input 
            v-model="newVersionNote" 
            :placeholder="$t('AdminMM.notes.content.newVersionDialog.placeholder')"
            maxlength="255"
            show-word-limit
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="newVersionDialogOpen = false">{{ $t('AdminMM.notes.content.newVersionDialog.cancel') }}</el-button>
        <el-button type="primary" :loading="newVersionSubmitting" @click="createNewVersion">{{ $t('AdminMM.notes.content.newVersionDialog.create') }}</el-button>
      </template>
    </el-dialog>

    <EditNoteDialog v-model="editNoteDialogOpen" :note="noteInfo" @save="saveNoteBaseInfo" />
    <EditCategoryDialog v-model="editCategoryDialogOpen" :category="getCategoryEditModel(editCategoryTargetId || noteInfo?.categoryId)" @save="saveCategoryBaseInfo" />
    <CreateNoteDialog
      v-model="createNoteDialogOpen"
      :categories="(navCategories as unknown as CreateNoteCategoryDto[])"
      :default-category-id="createNoteDefaultCategoryId"
      @create="createNote"
    />
  </div>
</template>


<style scoped>
.note-content-page {
  display: flex;
  height: 100%;
  gap: 0;
}

/* 左侧：导航树 + 版本列表 */
.left-sidebar {
  width: 340px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-right: none;
}

:deep(.left-sidebar > *:first-child) {
  flex: 1;
  min-height: 0;
}

:deep(.left-sidebar > *:last-child) {
  flex: 0 0 320px;
  min-height: 0;
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

.stay-time {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--sloth-text-subtle);
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--sloth-bg);
  border: 1px solid var(--sloth-card-border);
}

.stay-icon {
  width: 14px;
  height: 14px;
  color: var(--sloth-text-secondary);
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

/* Toolbar icons / menu */
.icon-btn {
  padding: 6px;
  border-radius: 10px;
  color: var(--sloth-text-secondary);
}

.icon-btn:hover {
  background: var(--sloth-bg-hover);
  color: var(--sloth-text);
}

.icon {
  width: 18px;
  height: 18px;
}

.menu-icon {
  width: 16px;
  height: 16px;
  margin-right: 6px;
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
