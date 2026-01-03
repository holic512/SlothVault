<script setup lang="ts">
import { reactive, ref, watch, computed } from 'vue'
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

type ProjectMenuDto = {
  id: string
  projectId: string
  parentId: string | null
  label: string
  url: string | null
  isExternal: boolean
  weight: number
  status: number
  createdAt: string | Date
  updatedAt: string | Date
  isDeleted: boolean
  children?: ProjectMenuDto[]
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

const dialogVisible = ref(false)

watch(() => props.modelValue, (val) => {
  dialogVisible.value = val
  if (val && props.projectId) {
    filters.includeDeleted = false
    fetchMenuList()
  }
})

watch(dialogVisible, (val) => {
  emit('update:modelValue', val)
})

const loading = ref(false)
const list = ref<ProjectMenuDto[]>([])

const filters = reactive({
  includeDeleted: false,
})

// 默认菜单（不可修改）
const defaultMenus = [
  { id: '__default_home__', label: '首页', url: '/home', isExternal: false, weight: -2, status: 1, isDefault: true },
  { id: '__default_docs__', label: '文档', url: '/docs', isExternal: false, weight: -1, status: 1, isDefault: true },
]

// 表单弹窗
const formDialogOpen = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const formSubmitting = ref(false)
const formRef = ref<InstanceType<typeof ElForm> | null>(null)

const form = reactive({
  id: '',
  parentId: null as string | null,
  label: '',
  url: '',
  isExternal: false,
  weight: 0,
  status: 1,
})

const formRules = {
  label: [{ required: true, message: '请输入菜单文本', trigger: 'blur' }],
}

// 可选的父级菜单（只能选一级菜单）
const parentOptions = computed(() => {
  return list.value
    .filter(m => !m.isDeleted && m.parentId === null)
    .map(m => ({ id: m.id, label: m.label }))
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

async function fetchMenuList() {
  if (!props.projectId) return
  loading.value = true
  try {
    const data = await apiFetch<ProjectMenuDto[]>('/api/admin/mm/menu', {
      method: 'GET',
      query: {
        projectId: props.projectId,
        tree: 'true',
        includeDeleted: filters.includeDeleted ? '1' : undefined,
      },
    })
    list.value = data
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '加载菜单列表失败')
    }
  } finally {
    loading.value = false
  }
}

function openCreate(parentId: string | null = null) {
  formMode.value = 'create'
  form.id = ''
  form.parentId = parentId
  form.label = ''
  form.url = ''
  form.isExternal = false
  form.weight = 0
  form.status = 1
  formDialogOpen.value = true
}

function openEdit(row: ProjectMenuDto) {
  formMode.value = 'edit'
  form.id = row.id
  form.parentId = row.parentId
  form.label = row.label
  form.url = row.url || ''
  form.isExternal = row.isExternal
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
      await apiFetch<ProjectMenuDto>('/api/admin/mm/menu', {
        method: 'POST',
        body: {
          projectId: props.projectId,
          parentId: form.parentId || null,
          label: form.label,
          url: form.url || null,
          isExternal: form.isExternal,
          weight: form.weight,
          status: form.status,
        },
      })
      ElMessage.success('创建成功')
    } else {
      await apiFetch<ProjectMenuDto>(`/api/admin/mm/menu/${form.id}`, {
        method: 'PUT',
        body: {
          parentId: form.parentId,
          label: form.label,
          url: form.url || null,
          isExternal: form.isExternal,
          weight: form.weight,
          status: form.status,
        },
      })
      ElMessage.success('保存成功')
    }
    formDialogOpen.value = false
    fetchMenuList()
    emit('updated')
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '提交失败')
    }
  } finally {
    formSubmitting.value = false
  }
}

async function deleteMenu(row: ProjectMenuDto) {
  const hasChildren = row.children && row.children.length > 0
  const msg = hasChildren
    ? `确认删除菜单「${row.label}」及其子菜单？`
    : `确认删除菜单「${row.label}」？`

  try {
    await ElMessageBox.confirm(msg, '提示', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await apiFetch(`/api/admin/mm/menu/${row.id}`, { method: 'DELETE' })
    ElMessage.success('已删除')
    fetchMenuList()
    emit('updated')
  } catch (e: any) {
    if (e?.message && e.message !== 'cancel' && e.message !== 'close' && e.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '删除失败')
    }
  }
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    :title="`菜单配置 - ${projectName}`"
    width="900px"
    :close-on-click-modal="false"
  >
    <div class="menu-toolbar">
      <div class="menu-filters">
        <div class="filter-item switch-item">
          <span class="switch-label">包含已删除</span>
          <el-switch v-model="filters.includeDeleted" @change="fetchMenuList()" />
        </div>
      </div>
      <div class="menu-actions">
        <el-button type="primary" plain @click="openCreate(null)">新增一级菜单</el-button>
      </div>
    </div>

    <!-- 默认菜单（不可修改） -->
    <div class="default-menus-section">
      <div class="section-title">默认菜单（不可修改）</div>
      <el-table :data="defaultMenus" style="width: 100%">
        <el-table-column prop="label" label="菜单文本" min-width="160" />
        <el-table-column prop="url" label="跳转链接" min-width="200">
          <template #default="{ row }">
            <span class="url-text">{{ row.url }}</span>
          </template>
        </el-table-column>
        <el-table-column label="外链" width="80" align="center">
          <template #default>
            <span class="text-subtle">否</span>
          </template>
        </el-table-column>
        <el-table-column prop="weight" label="权重" width="80" align="center" />
        <el-table-column label="状态" width="90">
          <template #default>
            <el-tag type="success">启用</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default>
            <span class="text-subtle">系统默认</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 自定义菜单 -->
    <div class="custom-menus-section">
      <div class="section-title">自定义菜单</div>
    </div>

    <el-table
      :data="list"
      row-key="id"
      style="width: 100%"
      v-loading="loading"
      :tree-props="{ children: 'children' }"
      default-expand-all
    >
      <el-table-column prop="label" label="菜单文本" min-width="160" />
      <el-table-column prop="url" label="跳转链接" min-width="200">
        <template #default="{ row }">
          <span v-if="row.url" class="url-text">{{ row.url }}</span>
          <span v-else class="text-subtle">-</span>
        </template>
      </el-table-column>
      <el-table-column label="外链" width="80" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.isExternal" type="warning" size="small">是</el-tag>
          <span v-else class="text-subtle">否</span>
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
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="!row.parentId"
            size="small"
            @click="openCreate(row.id)"
            :disabled="row.isDeleted"
          >
            添加子菜单
          </el-button>
          <el-button size="small" @click="openEdit(row)" :disabled="row.isDeleted">
            编辑
          </el-button>
          <el-button size="small" type="danger" @click="deleteMenu(row)" :disabled="row.isDeleted">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-dialog>

  <!-- 菜单新增/编辑弹窗 -->
  <el-dialog
    v-model="formDialogOpen"
    :title="formMode === 'create' ? '新增菜单' : '编辑菜单'"
    width="480px"
    :close-on-click-modal="false"
    append-to-body
  >
    <el-form ref="formRef" :model="form" :rules="formRules" label-width="80px">
      <el-form-item label="父级菜单">
        <el-select
          v-model="form.parentId"
          placeholder="无（一级菜单）"
          clearable
          style="width: 100%"
          :disabled="formMode === 'edit'"
        >
          <el-option
            v-for="opt in parentOptions"
            :key="opt.id"
            :label="opt.label"
            :value="opt.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="菜单文本" prop="label">
        <el-input v-model="form.label" maxlength="64" show-word-limit placeholder="显示的菜单名称" />
      </el-form-item>

      <el-form-item label="跳转链接">
        <el-input v-model="form.url" maxlength="2048" placeholder="站内路径或外部URL（可选）" />
      </el-form-item>

      <el-form-item label="外链">
        <el-switch v-model="form.isExternal" />
        <span class="form-tip">开启后将在新窗口打开</span>
      </el-form-item>

      <el-form-item label="权重">
        <el-input-number v-model="form.weight" :min="0" :max="999999" style="width: 100%" />
      </el-form-item>

      <el-form-item label="状态">
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
.menu-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.menu-filters {
  display: flex;
  gap: 12px;
}

.menu-actions {
  display: flex;
  gap: 6px;
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

.text-subtle {
  color: var(--sloth-text-subtle);
}

.url-text {
  font-size: 12px;
  color: var(--sloth-text);
  word-break: break-all;
}

.form-tip {
  margin-left: 8px;
  font-size: 12px;
  color: var(--sloth-text-subtle);
}

.default-menus-section,
.custom-menus-section {
  margin-bottom: 16px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--sloth-text);
  margin-bottom: 8px;
  padding-left: 4px;
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
