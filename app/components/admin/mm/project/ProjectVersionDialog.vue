<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
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

type ApiResponse<T> = {
  code: number
  message: string
  data: T
}

type ProjectVersionDto = {
  id: string
  projectId: string
  version: string
  description: string | null
  weight: number
  status: number
  createdAt: string | Date
  updatedAt: string | Date
  isDeleted: boolean
}

type VersionListData = {
  list: ProjectVersionDto[]
  page: number
  pageSize: number
  total: number
}

interface Props {
  modelValue: boolean
  projectId: string | null
  projectName: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'updated': []
}>()

const router = useRouter()

// 弹窗状态
const dialogVisible = ref(false)

// 同步 v-model
watch(() => props.modelValue, (val) => {
  dialogVisible.value = val
  if (val && props.projectId) {
    pagination.page = 1
    filters.includeDeleted = false
    fetchVersionList()
  }
})

watch(dialogVisible, (val) => {
  emit('update:modelValue', val)
})

// 版本列表
const loading = ref(false)
const list = ref<ProjectVersionDto[]>([])
const total = ref(0)

const pagination = reactive({
  page: 1,
  pageSize: 10,
})

const filters = reactive({
  includeDeleted: false,
})

// 版本表单弹窗
const formDialogOpen = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const formSubmitting = ref(false)
const formRef = ref<InstanceType<typeof ElForm> | null>(null)

const form = reactive({
  id: '',
  version: '',
  description: '',
  weight: 0,
  status: 1,
})

const formRules = {
  version: [{ required: true, message: '请输入版本号', trigger: 'blur' }],
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

async function fetchVersionList() {
  if (!props.projectId) return
  loading.value = true
  try {
    const data = await apiFetch<VersionListData>(
      `/api/admin/mm/projectVersion/byProject/${props.projectId}`,
      {
        method: 'GET',
        query: {
          page: pagination.page,
          pageSize: pagination.pageSize,
          includeDeleted: filters.includeDeleted ? '1' : undefined,
        },
      }
    )
    list.value = data.list
    total.value = data.total
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '加载版本列表失败')
    }
  } finally {
    loading.value = false
  }
}

function openCreate() {
  formMode.value = 'create'
  form.id = ''
  form.version = ''
  form.description = ''
  form.weight = 0
  form.status = 1
  formDialogOpen.value = true
}

function openEdit(row: ProjectVersionDto) {
  formMode.value = 'edit'
  form.id = row.id
  form.version = row.version
  form.description = row.description || ''
  form.weight = row.weight
  form.status = row.status
  formDialogOpen.value = true
}

async function submitForm() {
  const elForm = formRef.value
  if (!elForm || !props.projectId) return

  try {
    const valid = await elForm.validate().catch(() => false)
    if (!valid) return

    formSubmitting.value = true
    if (formMode.value === 'create') {
      await apiFetch<ProjectVersionDto>('/api/admin/mm/projectVersion', {
        method: 'POST',
        body: {
          projectId: props.projectId,
          version: form.version,
          description: form.description || null,
          weight: form.weight,
          status: form.status,
        },
      })
      ElMessage.success('创建成功')
    } else {
      await apiFetch<ProjectVersionDto>(`/api/admin/mm/projectVersion/${form.id}`, {
        method: 'PUT',
        body: {
          version: form.version,
          description: form.description || null,
          weight: form.weight,
          status: form.status,
        },
      })
      ElMessage.success('保存成功')
    }
    formDialogOpen.value = false
    fetchVersionList()
    emit('updated')
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '提交失败')
    }
  } finally {
    formSubmitting.value = false
  }
}

async function deleteVersion(row: ProjectVersionDto) {
  try {
    await ElMessageBox.confirm(`确认删除版本「${row.version}」？`, '提示', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await apiFetch<ProjectVersionDto>(`/api/admin/mm/projectVersion/${row.id}`, {
      method: 'DELETE',
    })
    ElMessage.success('已删除')
    fetchVersionList()
    emit('updated')
  } catch (e: any) {
    if (e?.message && e.message !== 'cancel' && e.message !== 'close' && e.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '删除失败')
    }
  }
}

async function restoreVersion(row: ProjectVersionDto) {
  try {
    await apiFetch<{ count: number }>('/api/admin/mm/projectVersion/batch', {
      method: 'POST',
      body: { action: 'restore', ids: [row.id] },
    })
    ElMessage.success('已恢复')
    fetchVersionList()
    emit('updated')
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '恢复失败')
    }
  }
}

function goToCategories(row: ProjectVersionDto) {
  router.push(`/admin/mm/categories?versionId=${row.id}`)
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    :title="`版本管理 - ${projectName}`"
    width="900px"
    :close-on-click-modal="false"
  >
    <div class="version-toolbar">
      <div class="version-filters">
        <div class="filter-item switch-item">
          <span class="switch-label">包含已删除</span>
          <el-switch
            v-model="filters.includeDeleted"
            @change="pagination.page = 1; fetchVersionList()"
          />
        </div>
      </div>
      <div class="version-actions">
        <el-button type="primary" plain @click="openCreate">新增版本</el-button>
      </div>
    </div>

    <el-table :data="list" row-key="id" style="width: 100%" v-loading="loading">
      <el-table-column prop="id" label="ID" width="100" />
      <el-table-column prop="version" label="版本号" width="120" />
      <el-table-column prop="description" label="版本简介" min-width="180">
        <template #default="{ row }">
          {{ row.description || '-' }}
        </template>
      </el-table-column>
      <el-table-column prop="weight" label="权重" width="80" align="center" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag v-if="row.isDeleted" type="info">已删除</el-tag>
          <el-tag v-else-if="row.status === 1" type="success">启用</el-tag>
          <el-tag v-else type="warning">停用</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="160">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="goToCategories(row)" :disabled="row.isDeleted">
            分类
          </el-button>
          <el-button size="small" @click="openEdit(row)" :disabled="row.isDeleted">
            编辑
          </el-button>
          <el-button size="small" type="danger" @click="deleteVersion(row)" :disabled="row.isDeleted">
            删除
          </el-button>
          <el-button size="small" @click="restoreVersion(row)" v-if="row.isDeleted">
            恢复
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination">
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        :total="total"
        @size-change="() => { pagination.page = 1; fetchVersionList() }"
        @current-change="() => fetchVersionList()"
      />
    </div>
  </el-dialog>

  <!-- 版本新增/编辑弹窗 -->
  <el-dialog
    v-model="formDialogOpen"
    :title="formMode === 'create' ? '新增版本' : '编辑版本'"
    width="480px"
    :close-on-click-modal="false"
    append-to-body
  >
    <el-form ref="formRef" :model="form" :rules="formRules" label-width="80px">
      <el-form-item label="版本号" prop="version">
        <el-input v-model="form.version" maxlength="64" show-word-limit placeholder="如：v1.0.0" />
      </el-form-item>

      <el-form-item label="简介" prop="description">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          placeholder="版本简介（可选）"
        />
      </el-form-item>

      <el-form-item label="权重" prop="weight">
        <el-input-number v-model="form.weight" :min="0" :max="999999" style="width: 100%" />
      </el-form-item>

      <el-form-item label="状态" prop="status">
        <el-select v-model="form.status" style="width: 100%">
          <el-option label="启用(1)" :value="1" />
          <el-option label="停用(0)" :value="0" />
        </el-select>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="formDialogOpen = false">取消</el-button>
      <el-button type="primary" :loading="formSubmitting" @click="submitForm">保存</el-button>
    </template>
  </el-dialog>
</template>


<style scoped>
.version-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.version-filters {
  display: flex;
  gap: 12px;
}

.version-actions {
  display: flex;
  gap: 6px;
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

.pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

/* Element Plus 主题适配 */
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

:deep(.el-button--small) {
  padding: 4px 8px;
  font-size: 12px;
  height: 26px;
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

:deep(.el-switch.is-checked .el-switch__core) {
  background-color: var(--sloth-primary);
  border-color: var(--sloth-primary);
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

:deep(.el-select .el-select__wrapper) {
  background-color: var(--sloth-bg);
  box-shadow: 0 0 0 1px var(--sloth-card-border) inset;
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
</style>
