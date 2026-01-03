<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import dayjs from 'dayjs'
import {
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElImage,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElPagination,
  ElSelect,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTag,
  ElUpload,
  type UploadFile,
  type UploadProps,
} from 'element-plus'

definePageMeta({
  layout: 'admin-mm',
})

type ApiResponse<T> = {
  code: number
  message: string
  data: T
}

type FileDto = {
  id: string
  originalName: string
  fileName: string
  filePath: string
  fileSize: string
  businessType: string
  status: number
  createTime: string | Date
  url: string
}

type FileListData = {
  list: FileDto[]
  page: number
  pageSize: number
  total: number
}

const { t } = useI18n()
const router = useRouter()

const loading = ref(false)
const list = ref<FileDto[]>([])
const total = ref(0)

const filters = reactive({
  keyword: '',
  businessType: '' as string,
  includeDeleted: false,
})

const pagination = reactive({
  page: 1,
  pageSize: 10,
})

const selectedRows = ref<FileDto[]>([])
const selectedIds = computed(() => selectedRows.value.map((r) => r.id))

// 上传对话框
const uploadDialogOpen = ref(false)
const uploadBusinessType = ref('NoteAttachment')
const uploadFileList = ref<UploadFile[]>([])
const uploading = ref(false)

// 预览对话框
const previewDialogOpen = ref(false)
const previewUrl = ref('')

// 业务类型选项（与后端 BusinessTypeConfig 保持一致）
const businessTypeOptions = [
  { label: '项目头像', value: 'ProjectAvatar' },
  { label: '用户头像', value: 'UserAvatar' },
  { label: '笔记附件', value: 'NoteAttachment' },
  { label: '作业文件', value: 'HomeworkFile' },
  { label: '临时文件', value: 'TempFile' },
  { label: '其他', value: 'Other' },
]

function formatTime(value: string | Date) {
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '-'
  return dayjs(d).format('YYYY-MM-DD HH:mm:ss')
}

function formatFileSize(bytes: string | number) {
  const size = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`
  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

function getBusinessTypeLabel(type: string) {
  const option = businessTypeOptions.find((o) => o.value === type)
  return option?.label || type
}

function getBusinessTypeTagType(type: string) {
  const typeMap: Record<string, string> = {
    ProjectAvatar: 'primary',
    UserAvatar: 'success',
    NoteAttachment: 'warning',
    HomeworkFile: 'info',
    TempFile: 'danger',
    Other: '',
  }
  return typeMap[type] || ''
}

function isImageFile(file: FileDto) {
  const ext = file.originalName.split('.').pop()?.toLowerCase()
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext || '')
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
    const data = await apiFetch<FileListData>('/api/admin/mm/file', {
      method: 'GET',
      query: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        keyword: filters.keyword || undefined,
        businessType: filters.businessType || undefined,
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
  filters.businessType = ''
  filters.includeDeleted = false
  pagination.page = 1
  fetchList()
}

function openUploadDialog() {
  uploadFileList.value = []
  uploadBusinessType.value = 'NoteAttachment'
  uploadDialogOpen.value = true
}

const handleUploadChange: UploadProps['onChange'] = (file, fileList) => {
  uploadFileList.value = fileList
}

const handleUploadRemove: UploadProps['onRemove'] = (file, fileList) => {
  uploadFileList.value = fileList
}

async function submitUpload() {
  if (uploadFileList.value.length === 0) {
    ElMessage.warning('请选择要上传的文件')
    return
  }

  uploading.value = true
  try {
    const formData = new FormData()
    for (const file of uploadFileList.value) {
      if (file.raw) {
        formData.append('file', file.raw)
      }
    }

    const res = await $fetch<ApiResponse<any>>(`/api/admin/mm/file?businessType=${uploadBusinessType.value}`, {
      method: 'POST',
      body: formData,
    })

    if (res?.code === 0) {
      ElMessage.success('上传成功')
      uploadDialogOpen.value = false
      fetchList()
    } else if (res?.code === 401) {
      await router.push('/admin/auth/login')
    } else {
      ElMessage.error(res?.message || '上传失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '上传失败')
  } finally {
    uploading.value = false
  }
}

function previewFile(row: FileDto) {
  if (isImageFile(row)) {
    previewUrl.value = row.url
    previewDialogOpen.value = true
  } else {
    window.open(row.url, '_blank')
  }
}

async function deleteOne(row: FileDto) {
  try {
    await ElMessageBox.confirm(`确认删除文件「${row.originalName}」？`, '提示', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await apiFetch<any>(`/api/admin/mm/file/${row.id}`, { method: 'DELETE' })
    ElMessage.success('已删除')
    fetchList()
  } catch (e: any) {
    if (e?.message && e.message !== 'cancel' && e.message !== 'close' && e.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '删除失败')
    }
  }
}

async function hardDeleteOne(row: FileDto) {
  try {
    await ElMessageBox.confirm(`确认彻底删除文件「${row.originalName}」？此操作将删除磁盘文件，不可恢复！`, '警告', {
      confirmButtonText: '彻底删除',
      cancelButtonText: '取消',
      type: 'error',
    })
    await apiFetch<any>(`/api/admin/mm/file/${row.id}?hard=1`, { method: 'DELETE' })
    ElMessage.success('已彻底删除')
    fetchList()
  } catch (e: any) {
    if (e?.message && e.message !== 'cancel' && e.message !== 'close' && e.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '删除失败')
    }
  }
}

async function batchDelete() {
  if (selectedIds.value.length === 0) {
    ElMessage.warning('请选择要删除的文件')
    return
  }
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${selectedIds.value.length} 个文件？`, '提示', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await apiFetch<any>('/api/admin/mm/file/batch', {
      method: 'POST',
      body: { action: 'delete', ids: selectedIds.value },
    })
    ElMessage.success('批量删除成功')
    selectedRows.value = []
    fetchList()
  } catch (e: any) {
    if (e?.message && e.message !== 'cancel' && e.message !== 'close' && e.message !== 'Unauthorized') {
      ElMessage.error(e?.message || '批量删除失败')
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
          placeholder="按文件名模糊搜索"
          clearable
          class="filter-item"
          @keyup.enter="pagination.page = 1; fetchList()"
        />

        <el-select v-model="filters.businessType" placeholder="业务类型" clearable class="filter-item">
          <el-option v-for="opt in businessTypeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>

        <div class="filter-item switch-item">
          <span class="switch-label">包含已删除</span>
          <el-switch v-model="filters.includeDeleted" @change="pagination.page = 1; fetchList()" />
        </div>
      </div>

      <div class="actions">
        <el-button type="primary" @click="pagination.page = 1; fetchList()">查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
        <el-button type="primary" plain @click="openUploadDialog">上传文件</el-button>
        <el-button type="danger" plain @click="batchDelete" :disabled="selectedIds.length === 0">
          批量删除 ({{ selectedIds.length }})
        </el-button>
      </div>
    </div>

    <div class="table-card">
      <el-table
        :data="list"
        row-key="id"
        style="width: 100%"
        v-loading="loading"
        @selection-change="(rows: FileDto[]) => (selectedRows = rows)"
      >
        <el-table-column type="selection" width="50" />
        <el-table-column prop="id" label="ID" width="80" />
        
        <el-table-column label="预览" width="80">
          <template #default="{ row }">
            <el-image
              v-if="isImageFile(row)"
              :src="row.url"
              :preview-src-list="[row.url]"
              fit="cover"
              class="preview-thumb"
              preview-teleported
            />
            <span v-else class="file-icon">📄</span>
          </template>
        </el-table-column>

        <el-table-column prop="originalName" label="原始文件名" min-width="200" show-overflow-tooltip />
        
        <el-table-column label="文件大小" width="100">
          <template #default="{ row }">{{ formatFileSize(row.fileSize) }}</template>
        </el-table-column>

        <el-table-column label="业务类型" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="getBusinessTypeTagType(row.businessType)">
              {{ getBusinessTypeLabel(row.businessType) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.status === 1" type="success" size="small">正常</el-tag>
            <el-tag v-else type="info" size="small">已删除</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="上传时间" width="170">
          <template #default="{ row }">{{ formatTime(row.createTime) }}</template>
        </el-table-column>

        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="previewFile(row)">预览</el-button>
            <el-button size="small" type="danger" @click="deleteOne(row)" :disabled="row.status === 0">删除</el-button>
            <el-button size="small" type="danger" plain @click="hardDeleteOne(row)" v-if="row.status === 0">
              彻底删除
            </el-button>
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

    <!-- 上传对话框 -->
    <el-dialog v-model="uploadDialogOpen" title="上传文件" width="500px" :close-on-click-modal="false">
      <el-form label-width="90px">
        <el-form-item label="业务类型">
          <el-select v-model="uploadBusinessType" style="width: 100%">
            <el-option v-for="opt in businessTypeOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>

        <el-form-item label="选择文件">
          <el-upload
            class="upload-area"
            drag
            multiple
            :auto-upload="false"
            :file-list="uploadFileList"
            :on-change="handleUploadChange"
            :on-remove="handleUploadRemove"
          >
            <div class="upload-content">
              <span class="upload-icon">📁</span>
              <div class="upload-text">将文件拖到此处，或点击上传</div>
              <div class="upload-tip">支持多文件上传，单文件最大 10MB</div>
            </div>
          </el-upload>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="uploadDialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="uploading" @click="submitUpload">上传</el-button>
      </template>
    </el-dialog>

    <!-- 预览对话框 -->
    <el-dialog v-model="previewDialogOpen" title="文件预览" width="80%" :close-on-click-modal="true">
      <div class="preview-container">
        <img :src="previewUrl" alt="preview" class="preview-image" />
      </div>
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
  grid-template-columns: 1fr 150px 180px;
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

.preview-thumb {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  object-fit: cover;
  cursor: pointer;
}

.file-icon {
  font-size: 24px;
}

.upload-area {
  width: 100%;
}

.upload-area :deep(.el-upload-dragger) {
  width: 100%;
  padding: 20px;
  background: var(--sloth-bg);
  border: 1px dashed var(--sloth-card-border);
}

.upload-area :deep(.el-upload-dragger:hover) {
  border-color: var(--sloth-primary);
}

.upload-content {
  text-align: center;
}

.upload-icon {
  font-size: 40px;
  display: block;
  margin-bottom: 8px;
}

.upload-text {
  font-size: 14px;
  color: var(--sloth-text);
  margin-bottom: 4px;
}

.upload-tip {
  font-size: 12px;
  color: var(--sloth-text-subtle);
}

.preview-container {
  display: flex;
  justify-content: center;
  align-items: center;
  max-height: 70vh;
  overflow: auto;
}

.preview-image {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
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

:deep(.el-button--danger.is-plain) {
  --el-button-bg-color: rgba(239, 68, 68, 0.1);
  --el-button-text-color: var(--sloth-danger);
  --el-button-border-color: var(--sloth-danger);
  --el-button-hover-bg-color: var(--sloth-danger);
  --el-button-hover-text-color: #fff;
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

:deep(.el-tag--info) {
  --el-tag-bg-color: var(--sloth-bg-hover);
  --el-tag-border-color: var(--sloth-card-border);
  --el-tag-text-color: var(--sloth-text-subtle);
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
