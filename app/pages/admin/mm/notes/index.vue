<script setup lang="ts">
import {computed, onMounted, reactive, ref, watch} from 'vue'
import dayjs from 'dayjs'
import {
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElPagination,
  ElSelect,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus'

definePageMeta({
  layout: 'admin-mm',
})

type ApiResponse<T> = {
  code: number
  message: string
  data: T
}

type NoteDto = {
  id: string
  categoryId: string
  noteTitle: string
  weight: number
  status: number
  createdAt: string | Date
  updatedAt: string | Date
  isDeleted: boolean
  contentCount: number
  category?: {
    id: string
    categoryName: string
    projectVersionId: string
    projectVersion?: {
      id: string
      version: string
      projectId: string
      project?: {
        id: string
        projectName: string
      } | null
    } | null
  } | null
}

type CategoryDto = {
  id: string
  categoryName: string
  projectVersionId: string
}

type ProjectVersionDto = {
  id: string
  projectId: string
  version: string
}

type ProjectDto = {
  id: string
  projectName: string
}

type NoteListData = {
  list: NoteDto[]
  page: number
  pageSize: number
  total: number
}

const {t} = useI18n()
const router = useRouter()
const route = useRoute()

const loading = ref(false)
const list = ref<NoteDto[]>([])
const total = ref(0)

// 从路由获取过滤参数
const routeCategoryId = computed(() => route.query.categoryId as string || '')
const routeVersionId = computed(() => route.query.versionId as string || '')
const routeProjectId = computed(() => route.query.projectId as string || '')

// 项目、版本、分类选择
const projects = ref<ProjectDto[]>([])
const versions = ref<ProjectVersionDto[]>([])
const categories = ref<CategoryDto[]>([])
const selectedProjectId = ref('')
const selectedVersionId = ref('')
const selectedCategoryId = ref('')

const filters = reactive({
  keyword: '',
  status: '' as '' | '1' | '0',
  includeDeleted: false,
})

const pagination = reactive({
  page: 1,
  pageSize: 10,
})

const selectedRows = ref<NoteDto[]>([])
const selectedIds = computed(() => selectedRows.value.map((r) => r.id))

const dialogOpen = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const dialogSubmitting = ref(false)

const formRef = ref<InstanceType<typeof ElForm> | null>(null)
const form = reactive({
  id: '' as string,
  noteTitle: '' as string,
  weight: 0 as number,
  status: 1 as number,
})

const formRules = {
  noteTitle: [{required: true, message: '请输入笔记标题', trigger: 'blur'}],
}

function formatTime(value: string | Date) {
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '-'
  return dayjs(d).format('YYYY-MM-DD HH:mm:ss')
}

async function apiFetch<T>(url: string, options?: any): Promise<T> {
  const res = await $fetch<ApiResponse<T>>(url, options)
  if (res?.code === 0) return res.data
  if (res?.code === 401) {
    await router.push('/admin/auth/login')
    throw new Error('Unauthorized')
  }
  throw new Error(res?.message || '请求失败')
}

async function fetchProjects() {
  try {
    const data = await apiFetch<{list: ProjectDto[]}>('/api/admin/mm/project', {
      method: 'GET',
      query: {pageSize: 100},
    })
    projects.value = data.list
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error('加载项目列表失败')
    }
  }
}

async function fetchVersions(projectId: string) {
  if (!projectId) {
    versions.value = []
    return
  }
  try {
    const data = await apiFetch<{list: ProjectVersionDto[]}>(`/api/admin/mm/projectVersion/byProject/${projectId}`, {
      method: 'GET',
      query: {pageSize: 100},
    })
    versions.value = data.list
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error('加载版本列表失败')
    }
  }
}

async function fetchCategories(versionId: string) {
  if (!versionId) {
    categories.value = []
    return
  }
  try {
    const data = await apiFetch<{list: CategoryDto[]}>(`/api/admin/mm/category/byProjectVersion/${versionId}`, {
      method: 'GET',
      query: {pageSize: 100},
    })
    categories.value = data.list
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error('加载分类列表失败')
    }
  }
}

async function fetchList() {
  loading.value = true
  try {
    const query: any = {
      page: pagination.page,
      pageSize: pagination.pageSize,
      keyword: filters.keyword || undefined,
      status: filters.status || undefined,
      includeDeleted: filters.includeDeleted ? '1' : undefined,
    }

    // 优先使用选择器的值，其次使用路由参数
    if (selectedCategoryId.value) {
      query.categoryId = selectedCategoryId.value
    } else if (routeCategoryId.value) {
      query.categoryId = routeCategoryId.value
    }

    if (selectedVersionId.value) {
      query.projectVersionId = selectedVersionId.value
    } else if (routeVersionId.value) {
      query.projectVersionId = routeVersionId.value
    }

    if (selectedProjectId.value) {
      query.projectId = selectedProjectId.value
    } else if (routeProjectId.value) {
      query.projectId = routeProjectId.value
    }

    const data = await apiFetch<NoteListData>('/api/admin/mm/note', {
      method: 'GET',
      query,
    })
    list.value = data.list
    total.value = data.total
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '加载失败')
    }
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  filters.keyword = ''
  filters.status = ''
  filters.includeDeleted = false
  selectedProjectId.value = ''
  selectedVersionId.value = ''
  selectedCategoryId.value = ''
  pagination.page = 1
  // 清除路由参数
  router.replace({query: {}})
  fetchList()
}

function openCreate() {
  if (!selectedCategoryId.value && !routeCategoryId.value) {
    ElMessage.warning('请先选择分类')
    return
  }
  dialogMode.value = 'create'
  form.id = ''
  form.noteTitle = ''
  form.weight = 0
  form.status = 1
  dialogOpen.value = true
}

function openEdit(row: NoteDto) {
  dialogMode.value = 'edit'
  form.id = row.id
  form.noteTitle = row.noteTitle
  form.weight = row.weight
  form.status = row.status
  dialogOpen.value = true
}

async function submitForm() {
  const elForm = formRef.value
  if (!elForm) return

  const categoryId = selectedCategoryId.value || routeCategoryId.value
  if (!categoryId && dialogMode.value === 'create') {
    ElMessage.warning('请先选择分类')
    return
  }

  try {
    const valid = await elForm.validate().catch(() => false)
    if (!valid) return

    dialogSubmitting.value = true
    if (dialogMode.value === 'create') {
      await apiFetch<NoteDto>('/api/admin/mm/note', {
        method: 'POST',
        body: {
          categoryId,
          noteTitle: form.noteTitle,
          weight: form.weight,
          status: form.status,
        },
      })
      ElMessage.success('创建成功')
    } else {
      await apiFetch<NoteDto>(`/api/admin/mm/note/${form.id}`, {
        method: 'PUT',
        body: {
          noteTitle: form.noteTitle,
          weight: form.weight,
          status: form.status,
        },
      })
      ElMessage.success('保存成功')
    }
    dialogOpen.value = false
    fetchList()
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '提交失败')
    }
  } finally {
    dialogSubmitting.value = false
  }
}

async function deleteOne(row: NoteDto) {
  try {
    await ElMessageBox.confirm(`确认删除笔记「${row.noteTitle}」？`, '提示', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await apiFetch<NoteDto>(`/api/admin/mm/note/${row.id}`, {method: 'DELETE'})
    ElMessage.success('已删除')
    fetchList()
  } catch (e: any) {
    if (e?.message && e.message !== 'cancel' && e.message !== 'close' && e.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '删除失败')
    }
  }
}

async function restoreOne(row: NoteDto) {
  try {
    await apiFetch<NoteDto>(`/api/admin/mm/note/${row.id}`, {
      method: 'PUT',
      body: {isDeleted: false},
    })
    ElMessage.success('已恢复')
    fetchList()
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '恢复失败')
    }
  }
}

// 跳转到内容编辑页面
function goToContent(row: NoteDto) {
  router.push(`/admin/mm/notes/${row.id}/content`)
}

// 获取完整路径显示
function getFullPath(row: NoteDto) {
  const parts: string[] = []
  if (row.category?.projectVersion?.project?.projectName) {
    parts.push(row.category.projectVersion.project.projectName)
  }
  if (row.category?.projectVersion?.version) {
    parts.push(row.category.projectVersion.version)
  }
  if (row.category?.categoryName) {
    parts.push(row.category.categoryName)
  }
  return parts.join(' / ') || '-'
}

// 监听项目选择变化
watch(selectedProjectId, async (newVal, oldVal) => {
  if (oldVal) {
    selectedVersionId.value = ''
    selectedCategoryId.value = ''
  }
  if (newVal) {
    await fetchVersions(newVal)
  } else {
    versions.value = []
    categories.value = []
  }
})

// 监听版本选择变化
watch(selectedVersionId, async (newVal, oldVal) => {
  if (oldVal) {
    selectedCategoryId.value = ''
  }
  if (newVal) {
    await fetchCategories(newVal)
  } else {
    categories.value = []
  }
})

// 监听分类选择变化
watch(selectedCategoryId, () => {
  pagination.page = 1
  fetchList()
})

// 根据路由参数初始化
async function initFromRoute() {
  loading.value = true
  try {
    await fetchProjects()

    // 如果有分类ID，反向获取项目和版本信息
    if (routeCategoryId.value) {
      // 先获取笔记列表，从中获取分类信息
      const data = await apiFetch<NoteListData>('/api/admin/mm/note', {
        method: 'GET',
        query: {categoryId: routeCategoryId.value, pageSize: 1},
      })
      if (data.list.length > 0 && data.list[0].category?.projectVersion) {
        const pv = data.list[0].category.projectVersion
        if (pv.project) {
          selectedProjectId.value = pv.project.id
          await fetchVersions(pv.project.id)
          selectedVersionId.value = pv.id
          await fetchCategories(pv.id)
          selectedCategoryId.value = routeCategoryId.value
        }
      }
    } else if (routeVersionId.value) {
      // 如果有版本ID
      const data = await apiFetch<NoteListData>('/api/admin/mm/note', {
        method: 'GET',
        query: {projectVersionId: routeVersionId.value, pageSize: 1},
      })
      if (data.list.length > 0 && data.list[0].category?.projectVersion?.project) {
        const project = data.list[0].category.projectVersion.project
        selectedProjectId.value = project.id
        await fetchVersions(project.id)
        selectedVersionId.value = routeVersionId.value
        await fetchCategories(routeVersionId.value)
      }
    } else if (routeProjectId.value) {
      // 如果有项目ID
      selectedProjectId.value = routeProjectId.value
      await fetchVersions(routeProjectId.value)
    }

    await fetchList()
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  initFromRoute()
})
</script>

<template>
  <div class="page-container">
    <div class="toolbar">
      <div class="filters">
        <el-select 
          v-model="selectedProjectId" 
          placeholder="选择项目" 
          clearable 
          filterable
          class="filter-item"
        >
          <el-option 
            v-for="p in projects" 
            :key="p.id" 
            :label="p.projectName" 
            :value="p.id"
          />
        </el-select>

        <el-select 
          v-model="selectedVersionId" 
          placeholder="选择版本" 
          clearable 
          filterable
          class="filter-item"
          :disabled="!selectedProjectId"
        >
          <el-option 
            v-for="v in versions" 
            :key="v.id" 
            :label="v.version" 
            :value="v.id"
          />
        </el-select>

        <el-select 
          v-model="selectedCategoryId" 
          placeholder="选择分类" 
          clearable 
          filterable
          class="filter-item"
          :disabled="!selectedVersionId"
        >
          <el-option 
            v-for="c in categories" 
            :key="c.id" 
            :label="c.categoryName" 
            :value="c.id"
          />
        </el-select>

        <el-input
          v-model="filters.keyword"
          placeholder="按笔记标题模糊搜索"
          clearable
          class="filter-item"
          @keyup.enter="pagination.page = 1; fetchList()"
        />

        <el-select v-model="filters.status" placeholder="状态" clearable class="filter-item filter-status">
          <el-option label="启用(1)" value="1"/>
          <el-option label="停用(0)" value="0"/>
        </el-select>

        <div class="filter-item switch-item">
          <span class="switch-label">包含已删除</span>
          <el-switch v-model="filters.includeDeleted" @change="pagination.page = 1; fetchList()"/>
        </div>
      </div>

      <div class="actions">
        <el-button type="primary" @click="pagination.page = 1; fetchList()">查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
        <el-button type="primary" plain @click="openCreate">新增笔记</el-button>
      </div>
    </div>

    <div class="table-card">
      <el-table
        :data="list"
        row-key="id"
        style="width: 100%"
        v-loading="loading"
        @selection-change="(rows: NoteDto[]) => (selectedRows = rows)"
      >
        <el-table-column type="selection" width="50"/>
        <el-table-column prop="id" label="ID" width="100"/>
        <el-table-column prop="noteTitle" label="笔记标题" min-width="200"/>
        <el-table-column label="所属路径" min-width="280">
          <template #default="{ row }">
            <span class="path-text">{{ getFullPath(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="weight" label="权重" width="80" align="center"/>

        <el-table-column label="内容版本" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.contentCount > 0" type="primary">{{ row.contentCount }}</el-tag>
            <span v-else class="text-subtle">0</span>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.isDeleted" type="info">已删除</el-tag>
            <el-tag v-else-if="row.status === 1" type="success">启用</el-tag>
            <el-tag v-else type="warning">停用</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>

        <el-table-column label="更新时间" width="170">
          <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
        </el-table-column>

        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" plain @click="goToContent(row)" :disabled="row.isDeleted">内容编辑</el-button>
            <el-button size="small" @click="openEdit(row)" :disabled="row.isDeleted">编辑</el-button>
            <el-button size="small" type="danger" @click="deleteOne(row)" :disabled="row.isDeleted">删除</el-button>
            <el-button size="small" @click="restoreOne(row)" v-if="row.isDeleted">恢复</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
          @size-change="() => { pagination.page = 1; fetchList() }"
          @current-change="() => fetchList()"
        />
      </div>
    </div>

    <el-dialog
      v-model="dialogOpen"
      :title="dialogMode === 'create' ? '新增笔记' : '编辑笔记'"
      width="480px"
      :close-on-click-modal="false"
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="90px">
        <el-form-item label="笔记标题" prop="noteTitle">
          <el-input v-model="form.noteTitle" maxlength="255" show-word-limit/>
        </el-form-item>

        <el-form-item label="权重" prop="weight">
          <el-input-number v-model="form.weight" :min="0" :max="999999" style="width: 100%"/>
        </el-form-item>

        <el-form-item label="状态" prop="status">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="启用(1)" :value="1"/>
            <el-option label="停用(0)" :value="0"/>
          </el-select>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="dialogSubmitting" @click="submitForm">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>


<style scoped>
.page-container {
  --sloth-radius: 4px;
}

.toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
  padding: 12px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
  backdrop-filter: blur(var(--sloth-blur));
}

.filters {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr 100px 160px;
  gap: 8px;
}

.filter-item {
  width: 100%;
}

.filter-status {
  width: 100px;
}

.switch-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.switch-label {
  color: var(--sloth-text-subtle);
  font-size: 13px;
  white-space: nowrap;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.table-card {
  padding: 12px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
  backdrop-filter: blur(var(--sloth-blur));
}

.pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.path-text {
  color: var(--sloth-text-secondary);
  font-size: 12px;
}

.text-subtle {
  color: var(--sloth-text-subtle);
}

:deep(.el-input__wrapper) {
  padding: 0 8px;
  background-color: var(--sloth-bg);
  box-shadow: 0 0 0 1px var(--sloth-card-border) inset;
}

:deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--sloth-primary) inset;
}

:deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px var(--sloth-primary) inset;
}

:deep(.el-input__inner) {
  height: 30px;
  line-height: 30px;
  font-size: 13px;
  color: var(--sloth-text);
}

:deep(.el-input__inner::placeholder) {
  color: var(--sloth-text-subtle);
}

:deep(.el-select) {
  --el-select-input-font-size: 13px;
}

:deep(.el-select .el-select__wrapper) {
  background-color: var(--sloth-bg);
  box-shadow: 0 0 0 1px var(--sloth-card-border) inset;
}

:deep(.el-select .el-select__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--sloth-primary) inset;
}

:deep(.el-switch.is-checked .el-switch__core) {
  background-color: var(--sloth-primary);
  border-color: var(--sloth-primary);
}

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

:deep(.el-button--primary.is-plain) {
  --el-button-bg-color: var(--sloth-primary-dim);
  --el-button-text-color: var(--sloth-primary);
  --el-button-border-color: var(--sloth-primary);
  --el-button-hover-bg-color: var(--sloth-primary);
  --el-button-hover-text-color: #fff;
}

:deep(.el-button--default) {
  --el-button-bg-color: var(--sloth-bg);
  --el-button-text-color: var(--sloth-text);
  --el-button-border-color: var(--sloth-card-border);
  --el-button-hover-bg-color: var(--sloth-bg-hover);
  --el-button-hover-text-color: var(--sloth-primary);
  --el-button-hover-border-color: var(--sloth-primary);
}

:deep(.el-button--small) {
  padding: 4px 8px;
  font-size: 12px;
  height: 26px;
}

:deep(.el-table) {
  --el-table-bg-color: var(--sloth-card, #ffffff);
  --el-table-tr-bg-color: var(--sloth-card, #ffffff);
  --el-table-header-bg-color: var(--sloth-bg-hover, #f3f4f6);
  --el-table-header-text-color: var(--sloth-text);
  --el-table-text-color: var(--sloth-text);
  --el-table-border-color: var(--sloth-card-border);
  --el-table-row-hover-bg-color: var(--sloth-bg-hover, #f3f4f6);
  font-size: 13px;
  background-color: var(--sloth-card, #ffffff);
}

:deep(.el-table__inner-wrapper) {
  background-color: var(--sloth-card, #ffffff);
}

:deep(.el-table th.el-table__cell) {
  padding: 8px 0;
  font-size: 13px;
  font-weight: 600;
  background-color: var(--sloth-bg-hover, #f3f4f6);
}

:deep(.el-table td.el-table__cell) {
  padding: 6px 0;
  background-color: var(--sloth-card, #ffffff);
}

:deep(.el-table--enable-row-hover .el-table__body tr:hover > td.el-table__cell) {
  background-color: var(--sloth-bg-hover, #f3f4f6);
}

:deep(.el-table__fixed-right) {
  background-color: var(--sloth-card, #ffffff);
}

:deep(.el-table__fixed-right .el-table__cell) {
  background-color: var(--sloth-card, #ffffff);
}

:deep(.el-table__fixed-right-patch) {
  background-color: var(--sloth-bg-hover, #f3f4f6);
}

:deep(.el-tag) {
  padding: 0 6px;
  height: 22px;
  line-height: 22px;
  font-size: 12px;
}

:deep(.el-tag--success) {
  --el-tag-bg-color: rgba(16, 185, 129, 0.1);
  --el-tag-border-color: rgba(16, 185, 129, 0.2);
  --el-tag-text-color: #10b981;
}

:deep(.el-tag--warning) {
  --el-tag-bg-color: rgba(245, 158, 11, 0.1);
  --el-tag-border-color: rgba(245, 158, 11, 0.2);
  --el-tag-text-color: #f59e0b;
}

:deep(.el-tag--info) {
  --el-tag-bg-color: var(--sloth-bg-hover);
  --el-tag-border-color: var(--sloth-card-border);
  --el-tag-text-color: var(--sloth-text-subtle);
}

:deep(.el-tag--primary) {
  --el-tag-bg-color: rgba(59, 130, 246, 0.1);
  --el-tag-border-color: rgba(59, 130, 246, 0.2);
  --el-tag-text-color: #3b82f6;
}

:deep(.el-pagination) {
  --el-pagination-font-size: 13px;
  --el-pagination-button-height: 28px;
  --el-pagination-bg-color: var(--sloth-bg);
  --el-pagination-text-color: var(--sloth-text);
  --el-pagination-button-color: var(--sloth-text);
  --el-pagination-hover-color: var(--sloth-primary);
}

:deep(.el-dialog) {
  --el-dialog-bg-color: var(--sloth-card);
  --el-dialog-padding-primary: 16px;
  border: 1px solid var(--sloth-card-border);
  backdrop-filter: blur(var(--sloth-blur));
}

:deep(.el-dialog__header) {
  padding: 12px 16px;
  margin-right: 0;
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

:deep(.el-form-item) {
  margin-bottom: 14px;
}

:deep(.el-form-item__label) {
  font-size: 13px;
  padding-right: 8px;
  color: var(--sloth-text);
}

@media (max-width: 1200px) {
  .filters {
    grid-template-columns: 1fr 1fr 1fr;
  }
}

@media (max-width: 768px) {
  .filters {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 480px) {
  .filters {
    grid-template-columns: 1fr;
  }
}
</style>
