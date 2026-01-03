<script setup lang="ts">
import {computed, onMounted, reactive, ref} from 'vue'
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

type ProjectDto = {
  id: string
  projectName: string
  weight: number
  status: number
  requireAuth: boolean
  createdAt: string | Date
  updatedAt: string | Date
  isDeleted: boolean
}

type ProjectListData = {
  list: ProjectDto[]
  page: number
  pageSize: number
  total: number
}

const {t} = useI18n()
const router = useRouter()

const loading = ref(false)
const list = ref<ProjectDto[]>([])
const total = ref(0)

const filters = reactive({
  keyword: '',
  status: '' as '' | '1' | '0',
  requireAuth: '' as '' | 'true' | 'false',
  includeDeleted: false,
})

const pagination = reactive({
  page: 1,
  pageSize: 10,
})

const selectedRows = ref<ProjectDto[]>([])
const selectedIds = computed(() => selectedRows.value.map((r) => r.id))

const dialogOpen = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const dialogSubmitting = ref(false)

const formRef = ref<InstanceType<typeof ElForm> | null>(null)
const form = reactive({
  id: '' as string,
  projectName: '' as string,
  weight: 0 as number,
  status: 1 as number,
  requireAuth: false as boolean,
})

const formRules = {
  projectName: [{required: true, message: '请输入项目名称', trigger: 'blur'}],
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

async function fetchList() {
  loading.value = true
  try {
    const data = await apiFetch<ProjectListData>('/api/admin/mm/project', {
      method: 'GET',
      query: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        keyword: filters.keyword || undefined,
        status: filters.status || undefined,
        requireAuth: filters.requireAuth || undefined,
        includeDeleted: filters.includeDeleted ? '1' : undefined,
      },
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
  filters.requireAuth = ''
  filters.includeDeleted = false
  pagination.page = 1
  fetchList()
}

function openCreate() {
  dialogMode.value = 'create'
  form.id = ''
  form.projectName = ''
  form.weight = 0
  form.status = 1
  form.requireAuth = false
  dialogOpen.value = true
}

function openEdit(row: ProjectDto) {
  dialogMode.value = 'edit'
  form.id = row.id
  form.projectName = row.projectName
  form.weight = row.weight
  form.status = row.status
  form.requireAuth = row.requireAuth
  dialogOpen.value = true
}

async function submitForm() {
  const elForm = formRef.value
  if (!elForm) return

  try {
    const valid = await elForm.validate().catch(() => false)
    if (!valid) return

    dialogSubmitting.value = true
    if (dialogMode.value === 'create') {
      await apiFetch<ProjectDto>('/api/admin/mm/project', {
        method: 'POST',
        body: {
          projectName: form.projectName,
          weight: form.weight,
          status: form.status,
          requireAuth: form.requireAuth,
        },
      })
      ElMessage.success('创建成功')
    } else {
      await apiFetch<ProjectDto>(`/api/admin/mm/project/${form.id}`, {
        method: 'PUT',
        body: {
          projectName: form.projectName,
          weight: form.weight,
          status: form.status,
          requireAuth: form.requireAuth,
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

async function deleteOne(row: ProjectDto) {
  try {
    await ElMessageBox.confirm(`确认删除项目「${row.projectName}」？`, '提示', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await apiFetch<ProjectDto>(`/api/admin/mm/project/${row.id}`, {method: 'DELETE'})
    ElMessage.success('已删除')
    fetchList()
  } catch (e: any) {
    if (e?.message && e.message !== 'cancel' && e.message !== 'close' && e.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '删除失败')
    }
  }
}

async function restoreOne(row: ProjectDto) {
  await batchRestore([row.id])
}

async function batchDelete(ids: string[] = selectedIds.value) {
  if (ids.length === 0) {
    ElMessage.warning('请先选择要操作的项目')
    return
  }
  try {
    await ElMessageBox.confirm(`确认批量删除所选 ${ids.length} 项？`, '提示', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    const data = await apiFetch<{ count: number }>('/api/admin/mm/project/batch', {
      method: 'POST',
      body: {action: 'delete', ids},
    })
    ElMessage.success(`已删除 ${data.count} 项`)
    fetchList()
  } catch (e: any) {
    if (e?.message && e.message !== 'cancel' && e.message !== 'close' && e.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '批量删除失败')
    }
  }
}

async function batchRestore(ids: string[] = selectedIds.value) {
  if (ids.length === 0) {
    ElMessage.warning('请先选择要操作的项目')
    return
  }
  try {
    const data = await apiFetch<{ count: number }>('/api/admin/mm/project/batch', {
      method: 'POST',
      body: {action: 'restore', ids},
    })
    ElMessage.success(`已恢复 ${data.count} 项`)
    fetchList()
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '批量恢复失败')
    }
  }
}

async function batchSetStatus(status: number) {
  const ids = selectedIds.value
  if (ids.length === 0) {
    ElMessage.warning('请先选择要操作的项目')
    return
  }
  try {
    const data = await apiFetch<{ count: number }>('/api/admin/mm/project/batch', {
      method: 'POST',
      body: {action: 'setStatus', ids, status},
    })
    ElMessage.success(`已更新 ${data.count} 项`)
    fetchList()
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '批量更新失败')
    }
  }
}

async function batchSetRequireAuth(requireAuth: boolean) {
  const ids = selectedIds.value
  if (ids.length === 0) {
    ElMessage.warning('请先选择要操作的项目')
    return
  }
  try {
    const data = await apiFetch<{ count: number }>('/api/admin/mm/project/batch', {
      method: 'POST',
      body: {action: 'setRequireAuth', ids, requireAuth},
    })
    ElMessage.success(`已更新 ${data.count} 项`)
    fetchList()
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '批量更新失败')
    }
  }
}

onMounted(() => {
  fetchList()
})
</script>

<template>
  <div class="page-container">
    <div class="toolbar">
      <div class="filters">
        <el-input
            v-model="filters.keyword"
            placeholder="按项目名模糊搜索"
            clearable
            class="filter-item"
            @keyup.enter="pagination.page = 1; fetchList()"
        />

        <el-select v-model="filters.status" placeholder="状态" clearable class="filter-item">
          <el-option label="启用(1)" value="1"/>
          <el-option label="停用(0)" value="0"/>
        </el-select>

        <el-select v-model="filters.requireAuth" placeholder="鉴权" clearable class="filter-item">
          <el-option label="需要鉴权" value="true"/>
          <el-option label="无需鉴权" value="false"/>
        </el-select>

        <div class="filter-item switch-item">
          <span class="switch-label">包含已删除</span>
          <el-switch v-model="filters.includeDeleted" @change="pagination.page = 1; fetchList()"/>
        </div>
      </div>

      <div class="actions">
        <el-button type="primary" @click="pagination.page = 1; fetchList()">查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
        <el-button type="primary" plain @click="openCreate">新增项目</el-button>
        <el-button type="danger" plain :disabled="selectedIds.length === 0" @click="batchDelete()">批量删除</el-button>
        <el-button plain :disabled="selectedIds.length === 0" @click="batchRestore()">批量恢复</el-button>
        <el-button plain :disabled="selectedIds.length === 0" @click="batchSetStatus(1)">批量启用</el-button>
        <el-button plain :disabled="selectedIds.length === 0" @click="batchSetStatus(0)">批量停用</el-button>
        <el-button plain :disabled="selectedIds.length === 0" @click="batchSetRequireAuth(true)">批量开启鉴权
        </el-button>
        <el-button plain :disabled="selectedIds.length === 0" @click="batchSetRequireAuth(false)">批量关闭鉴权
        </el-button>
      </div>
    </div>

    <div class="table-card">
      <el-table
          :data="list"
          row-key="id"
          style="width: 100%"
          v-loading="loading"
          @selection-change="(rows: ProjectDto[]) => (selectedRows = rows)"
      >
        <el-table-column type="selection" width="50"/>
        <el-table-column prop="id" label="ID" width="120"/>
        <el-table-column prop="projectName" label="项目名称" min-width="220"/>
        <el-table-column prop="weight" label="权重" width="90"/>

        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.isDeleted" type="info">已删除</el-tag>
            <el-tag v-else-if="row.status === 1" type="success">启用</el-tag>
            <el-tag v-else type="warning">停用</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="鉴权" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.requireAuth" type="warning">需要</el-tag>
            <el-tag v-else type="info">无需</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="创建时间" width="180">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>

        <el-table-column label="更新时间" width="180">
          <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
        </el-table-column>

        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
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
        :title="dialogMode === 'create' ? '新增项目' : '编辑项目'"
        width="520px"
        :close-on-click-modal="false"
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="100px">
        <el-form-item label="项目名称" prop="projectName">
          <el-input v-model="form.projectName" maxlength="128" show-word-limit/>
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

        <el-form-item label="需要鉴权" prop="requireAuth">
          <el-switch v-model="form.requireAuth"/>
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

/* 工具栏卡片 */
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
  grid-template-columns: 1fr 130px 130px 180px;
  gap: 8px;
}

.filter-item {
  width: 100%;
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

/* 表格卡片 */
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

/* Element Plus 主题适配 */
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

/* 按钮主题适配 */
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

:deep(.el-button--default.is-plain) {
  --el-button-bg-color: transparent;
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

/* 表格主题适配 */
:deep(.el-table) {
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: var(--sloth-bg-hover);
  --el-table-header-text-color: var(--sloth-text);
  --el-table-text-color: var(--sloth-text);
  --el-table-border-color: var(--sloth-card-border);
  --el-table-row-hover-bg-color: var(--sloth-bg-hover);
  font-size: 13px;
}

:deep(.el-table th.el-table__cell) {
  padding: 8px 0;
  font-size: 13px;
  font-weight: 600;
  background-color: var(--sloth-bg-hover);
}

:deep(.el-table td.el-table__cell) {
  padding: 6px 0;
}

:deep(.el-table--enable-row-hover .el-table__body tr:hover > td.el-table__cell) {
  background-color: var(--sloth-bg-hover);
}

:deep(.el-table .el-table__cell.is-right) {
  background-color: var(--sloth-card);
}

/* Tag 主题适配 */
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

/* 分页主题适配 */
:deep(.el-pagination) {
  --el-pagination-font-size: 13px;
  --el-pagination-button-height: 28px;
  --el-pagination-bg-color: var(--sloth-bg);
  --el-pagination-text-color: var(--sloth-text);
  --el-pagination-button-color: var(--sloth-text);
  --el-pagination-hover-color: var(--sloth-primary);
}

:deep(.el-pagination .el-input__wrapper) {
  background-color: var(--sloth-bg);
}

/* Dialog 主题适配 */
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

/* Loading 适配 */
:deep(.el-loading-mask) {
  background-color: rgba(var(--sloth-primary-rgb), 0.05);
}

@media (max-width: 960px) {
  .filters {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 640px) {
  .filters {
    grid-template-columns: 1fr;
  }
}
</style>
