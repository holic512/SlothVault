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
  avatar: string | null
  weight: number
  status: number
  requireAuth: boolean
  createdAt: string | Date
  updatedAt: string | Date
  isDeleted: boolean
  latestVersion: string | null
  latestVersionId: string | null
  categoryCount: number
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
  avatar: null as string | null,
  weight: 0 as number,
  status: 1 as number,
  requireAuth: false as boolean,
})

const formRules = computed(() => ({
  projectName: [{required: true, message: t('AdminMM.projects.validation.projectNameRequired'), trigger: 'blur'}],
}))

// 版本管理弹窗状态
const versionDialogOpen = ref(false)
const currentProject = ref<ProjectDto | null>(null)

// 菜单配置弹窗状态
const menuDialogOpen = ref(false)
const menuProject = ref<ProjectDto | null>(null)

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
  throw new Error(res?.message || t('AdminMM.projects.messages.requestFailed'))
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
      ElMessage.error(e?.message || t('AdminMM.projects.messages.loadFailed'))
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
  form.avatar = null
  form.weight = 0
  form.status = 1
  form.requireAuth = false
  dialogOpen.value = true
}

function openEdit(row: ProjectDto) {
  dialogMode.value = 'edit'
  form.id = row.id
  form.projectName = row.projectName
  form.avatar = row.avatar
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
          avatar: form.avatar,
          weight: form.weight,
          status: form.status,
          requireAuth: form.requireAuth,
        },
      })
      ElMessage.success(t('AdminMM.projects.messages.createSuccess'))
    } else {
      await apiFetch<ProjectDto>(`/api/admin/mm/project/${form.id}`, {
        method: 'PUT',
        body: {
          projectName: form.projectName,
          avatar: form.avatar,
          weight: form.weight,
          status: form.status,
          requireAuth: form.requireAuth,
        },
      })
      ElMessage.success(t('AdminMM.projects.messages.saveSuccess'))
    }
    dialogOpen.value = false
    fetchList()
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || t('AdminMM.projects.messages.submitFailed'))
    }
  } finally {
    dialogSubmitting.value = false
  }
}

async function deleteOne(row: ProjectDto) {
  try {
    await ElMessageBox.confirm(t('AdminMM.projects.messages.deleteConfirm', {name: row.projectName}), t('AdminMM.projects.messages.deleteConfirmTitle'), {
      confirmButtonText: t('AdminMM.projects.messages.deleteButton'),
      cancelButtonText: t('AdminMM.projects.messages.cancelButton'),
      type: 'warning',
    })
    await apiFetch<ProjectDto>(`/api/admin/mm/project/${row.id}`, {method: 'DELETE'})
    ElMessage.success(t('AdminMM.projects.messages.deleted'))
    fetchList()
  } catch (e: any) {
    if (e?.message && e.message !== 'cancel' && e.message !== 'close' && e.message !== 'Unauthorized') {
      ElMessage.error(e?.message || t('AdminMM.projects.messages.deleteFailed'))
    }
  }
}

async function restoreOne(row: ProjectDto) {
  await batchRestore([row.id])
}

async function batchDelete(ids: string[] = selectedIds.value) {
  if (ids.length === 0) {
    ElMessage.warning(t('AdminMM.projects.messages.selectFirst'))
    return
  }
  try {
    await ElMessageBox.confirm(t('AdminMM.projects.messages.batchDeleteConfirm', {count: ids.length}), t('AdminMM.projects.messages.deleteConfirmTitle'), {
      confirmButtonText: t('AdminMM.projects.messages.deleteButton'),
      cancelButtonText: t('AdminMM.projects.messages.cancelButton'),
      type: 'warning',
    })
    const data = await apiFetch<{ count: number }>('/api/admin/mm/project/batch', {
      method: 'POST',
      body: {action: 'delete', ids},
    })
    ElMessage.success(t('AdminMM.projects.messages.batchDeleted', {count: data.count}))
    fetchList()
  } catch (e: any) {
    if (e?.message && e.message !== 'cancel' && e.message !== 'close' && e.message !== 'Unauthorized') {
      ElMessage.error(e?.message || t('AdminMM.projects.messages.batchDeleteFailed'))
    }
  }
}

async function batchRestore(ids: string[] = selectedIds.value) {
  if (ids.length === 0) {
    ElMessage.warning(t('AdminMM.projects.messages.selectFirst'))
    return
  }
  try {
    const data = await apiFetch<{ count: number }>('/api/admin/mm/project/batch', {
      method: 'POST',
      body: {action: 'restore', ids},
    })
    ElMessage.success(t('AdminMM.projects.messages.batchRestored', {count: data.count}))
    fetchList()
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || t('AdminMM.projects.messages.batchRestoreFailed'))
    }
  }
}

async function batchSetStatus(status: number) {
  const ids = selectedIds.value
  if (ids.length === 0) {
    ElMessage.warning(t('AdminMM.projects.messages.selectFirst'))
    return
  }
  try {
    const data = await apiFetch<{ count: number }>('/api/admin/mm/project/batch', {
      method: 'POST',
      body: {action: 'setStatus', ids, status},
    })
    ElMessage.success(t('AdminMM.projects.messages.batchUpdated', {count: data.count}))
    fetchList()
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || t('AdminMM.projects.messages.batchUpdateFailed'))
    }
  }
}

async function batchSetRequireAuth(requireAuth: boolean) {
  const ids = selectedIds.value
  if (ids.length === 0) {
    ElMessage.warning(t('AdminMM.projects.messages.selectFirst'))
    return
  }
  try {
    const data = await apiFetch<{ count: number }>('/api/admin/mm/project/batch', {
      method: 'POST',
      body: {action: 'setRequireAuth', ids, requireAuth},
    })
    ElMessage.success(t('AdminMM.projects.messages.batchUpdated', {count: data.count}))
    fetchList()
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || t('AdminMM.projects.messages.batchUpdateFailed'))
    }
  }
}

onMounted(() => {
  fetchList()
})

// 跳转到分类管理页面
function goToCategories(row: ProjectDto) {
  if (row.latestVersionId) {
    router.push(`/admin/mm/categories?versionId=${row.latestVersionId}`)
  }
}

// 跳转到笔记管理页面
function goToNotes(row: ProjectDto) {
  router.push(`/admin/mm/notes?projectId=${row.id}`)
}

// 打开版本管理弹窗
function openVersionDialog(row: ProjectDto) {
  currentProject.value = row
  versionDialogOpen.value = true
}

// 版本更新后刷新列表
function onVersionUpdated() {
  fetchList()
}

// 打开菜单配置弹窗
function openMenuDialog(row: ProjectDto) {
  menuProject.value = row
  menuDialogOpen.value = true
}

// 跳转到首页编辑
function goToHomeEdit(row: ProjectDto) {
  router.push(`/admin/mm/projects/${row.id}/home`)
}
</script>

<template>
  <div class="page-container">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">{{ $t('AdminMM.projects.title') }}</h1>
        <p class="page-desc">{{ $t('AdminMM.projects.desc') }}</p>
      </div>
    </div>

    <div class="toolbar">
      <div class="filters">
        <el-input
            v-model="filters.keyword"
            :placeholder="$t('AdminMM.projects.filters.keyword')"
            clearable
            class="filter-item"
            @keyup.enter="pagination.page = 1; fetchList()"
        />

        <el-select v-model="filters.status" :placeholder="$t('AdminMM.projects.filters.status')" clearable class="filter-item">
          <el-option :label="$t('AdminMM.projects.status.enabled')" value="1"/>
          <el-option :label="$t('AdminMM.projects.status.disabled')" value="0"/>
        </el-select>

        <el-select v-model="filters.requireAuth" :placeholder="$t('AdminMM.projects.filters.requireAuth')" clearable class="filter-item">
          <el-option :label="$t('AdminMM.projects.auth.required')" value="true"/>
          <el-option :label="$t('AdminMM.projects.auth.notRequired')" value="false"/>
        </el-select>

        <div class="filter-item switch-item">
          <span class="switch-label">{{ $t('AdminMM.projects.filters.includeDeleted') }}</span>
          <el-switch v-model="filters.includeDeleted" @change="pagination.page = 1; fetchList()"/>
        </div>
      </div>

      <div class="actions">
        <el-button type="primary" @click="pagination.page = 1; fetchList()">{{ $t('AdminMM.projects.actions.search') }}</el-button>
        <el-button @click="resetFilters">{{ $t('AdminMM.projects.actions.reset') }}</el-button>
        <el-button type="primary" plain @click="openCreate">{{ $t('AdminMM.projects.actions.create') }}</el-button>
        <el-button type="danger" plain :disabled="selectedIds.length === 0" @click="batchDelete()">{{ $t('AdminMM.projects.actions.batchDelete') }}</el-button>
        <el-button plain :disabled="selectedIds.length === 0" @click="batchRestore()">{{ $t('AdminMM.projects.actions.batchRestore') }}</el-button>
        <el-button plain :disabled="selectedIds.length === 0" @click="batchSetStatus(1)">{{ $t('AdminMM.projects.actions.batchEnable') }}</el-button>
        <el-button plain :disabled="selectedIds.length === 0" @click="batchSetStatus(0)">{{ $t('AdminMM.projects.actions.batchDisable') }}</el-button>
        <el-button plain :disabled="selectedIds.length === 0" @click="batchSetRequireAuth(true)">{{ $t('AdminMM.projects.actions.batchEnableAuth') }}</el-button>
        <el-button plain :disabled="selectedIds.length === 0" @click="batchSetRequireAuth(false)">{{ $t('AdminMM.projects.actions.batchDisableAuth') }}</el-button>
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
        <el-table-column prop="id" :label="$t('AdminMM.projects.table.id')" width="120"/>
        <el-table-column :label="$t('AdminMM.projects.table.avatar')" width="80" align="center">
          <template #default="{ row }">
            <img
              v-if="row.avatar"
              :src="row.avatar"
              class="project-avatar"
              :alt="$t('AdminMM.projects.table.avatar')"
            />
            <div v-else class="avatar-placeholder-small">
              <span>{{ row.projectName?.charAt(0) || '?' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="projectName" :label="$t('AdminMM.projects.table.projectName')" min-width="220"/>
        <el-table-column prop="weight" :label="$t('AdminMM.projects.table.weight')" width="90" align="center"/>

        <el-table-column :label="$t('AdminMM.projects.table.status')" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.isDeleted" type="info">{{ $t('AdminMM.projects.statusTag.deleted') }}</el-tag>
            <el-tag v-else-if="row.status === 1" type="success">{{ $t('AdminMM.projects.statusTag.enabled') }}</el-tag>
            <el-tag v-else type="warning">{{ $t('AdminMM.projects.statusTag.disabled') }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column :label="$t('AdminMM.projects.table.latestVersion')" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.latestVersion" type="primary">{{ row.latestVersion }}</el-tag>
            <span v-else class="text-subtle">-</span>
          </template>
        </el-table-column>

        <el-table-column :label="$t('AdminMM.projects.table.categoryCount')" width="90" align="center">
          <template #default="{ row }">
            <span v-if="row.latestVersionId">{{ row.categoryCount }}</span>
            <span v-else class="text-subtle">-</span>
          </template>
        </el-table-column>

        <el-table-column :label="$t('AdminMM.projects.table.requireAuth')" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.requireAuth" type="warning">{{ $t('AdminMM.projects.authTag.required') }}</el-tag>
            <el-tag v-else type="info">{{ $t('AdminMM.projects.authTag.notRequired') }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column :label="$t('AdminMM.projects.table.createdAt')" width="180">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>

        <el-table-column :label="$t('AdminMM.projects.table.updatedAt')" width="180">
          <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
        </el-table-column>

        <el-table-column :label="$t('AdminMM.projects.table.operations')" width="560" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" plain @click="goToHomeEdit(row)">{{ $t('AdminMM.projects.operations.homeEdit') }}</el-button>
            <el-button size="small" @click="openVersionDialog(row)">{{ $t('AdminMM.projects.operations.versionManage') }}</el-button>
            <el-button size="small" @click="openMenuDialog(row)">{{ $t('AdminMM.projects.operations.menuConfig') }}</el-button>
            <el-button size="small" @click="goToCategories(row)" :disabled="!row.latestVersionId">{{ $t('AdminMM.projects.operations.categoryManage') }}</el-button>
            <el-button size="small" @click="goToNotes(row)">{{ $t('AdminMM.projects.operations.noteManage') }}</el-button>
            <el-button size="small" @click="openEdit(row)" :disabled="row.isDeleted">{{ $t('AdminMM.projects.operations.edit') }}</el-button>
            <el-button size="small" type="danger" @click="deleteOne(row)" :disabled="row.isDeleted">{{ $t('AdminMM.projects.operations.delete') }}</el-button>
            <el-button size="small" @click="restoreOne(row)" v-if="row.isDeleted">{{ $t('AdminMM.projects.operations.restore') }}</el-button>
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
        :title="dialogMode === 'create' ? $t('AdminMM.projects.dialog.createTitle') : $t('AdminMM.projects.dialog.editTitle')"
        width="520px"
        :close-on-click-modal="false"
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="100px">
        <el-form-item :label="$t('AdminMM.projects.dialog.avatar')">
          <AvatarUploader v-model="form.avatar" :size="80" />
        </el-form-item>

        <el-form-item :label="$t('AdminMM.projects.dialog.projectName')" prop="projectName">
          <el-input v-model="form.projectName" maxlength="128" show-word-limit/>
        </el-form-item>

        <el-form-item :label="$t('AdminMM.projects.dialog.weight')" prop="weight">
          <el-input-number v-model="form.weight" :min="0" :max="999999" style="width: 100%"/>
        </el-form-item>

        <el-form-item :label="$t('AdminMM.projects.dialog.status')" prop="status">
          <el-select v-model="form.status" style="width: 100%">
            <el-option :label="$t('AdminMM.projects.status.enabled')" :value="1"/>
            <el-option :label="$t('AdminMM.projects.status.disabled')" :value="0"/>
          </el-select>
        </el-form-item>

        <el-form-item :label="$t('AdminMM.projects.dialog.requireAuth')" prop="requireAuth">
          <el-switch v-model="form.requireAuth"/>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogOpen = false">{{ $t('AdminMM.projects.dialog.cancel') }}</el-button>
        <el-button type="primary" :loading="dialogSubmitting" @click="submitForm">{{ $t('AdminMM.projects.dialog.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- 版本管理弹窗组件 -->
    <AdminMmProjectVersionDialog
      v-model="versionDialogOpen"
      :project-id="currentProject?.id || null"
      :project-name="currentProject?.projectName || ''"
      @updated="onVersionUpdated"
    />

    <!-- 菜单配置弹窗组件 -->
    <AdminMmProjectMenuDialog
      v-model="menuDialogOpen"
      :project-id="menuProject?.id || null"
      :project-name="menuProject?.projectName || ''"
    />
  </div>
</template>

<style scoped>
.page-container {
  --sloth-radius: 4px;
}

/* 页面头部卡片 */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
  padding: 12px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
  backdrop-filter: blur(var(--sloth-blur));
}

.page-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--sloth-text);
  margin: 0 0 4px;
}

.page-desc {
  font-size: 13px;
  color: var(--sloth-text-subtle);
  margin: 0;
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

.text-subtle {
  color: var(--sloth-text-subtle);
}

:deep(.el-tag--primary) {
  --el-tag-bg-color: rgba(59, 130, 246, 0.1);
  --el-tag-border-color: rgba(59, 130, 246, 0.2);
  --el-tag-text-color: #3b82f6;
}

/* 项目头像样式 */
.project-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid var(--sloth-card-border);
}

.avatar-placeholder-small {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--sloth-primary-dim, rgba(59, 130, 246, 0.1));
  color: var(--sloth-primary, #3b82f6);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
  margin: 0 auto;
}
</style>
