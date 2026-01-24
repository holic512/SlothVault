<script setup lang="ts">
/**
 * 备份管理页面
 *
 * 功能：
 * - 数据库导出/导入
 * - 文件系统导出/导入
 * - 系统初始化（重置）
 */
import { ref } from 'vue'
import {
  ElButton,
  ElMessage,
  ElMessageBox,
  ElAlert,
  ElIcon,
  ElUpload,
  ElRadioGroup,
  ElRadioButton,
  ElProgress,
  ElDialog,
} from 'element-plus'
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  TrashIcon,
  DocumentTextIcon,
  FolderIcon,
  ExclamationTriangleIcon,
} from '@heroicons/vue/24/outline'
import type { UploadFile } from 'element-plus'

definePageMeta({
  layout: 'admin-mm',
})

const { t } = useI18n()
const router = useRouter()

type ApiResponse<T> = {
  code: number
  message: string
  data: T
}

// ============ 状态管理 ============
const dbExporting = ref(false)
const dbImporting = ref(false)
const filesExporting = ref(false)
const filesImporting = ref(false)
const resetting = ref(false)

const importMode = ref<'insert' | 'overwrite'>('insert')
const filesImportMode = ref<'insert' | 'overwrite'>('insert')

const resetDialogVisible = ref(false)
const resetOptions = ref({
  clearDatabase: true,
  clearFiles: true,
})

// ============ 数据库备份/恢复 ============
async function exportDatabase() {
  dbExporting.value = true
  try {
    const response = await fetch('/api/admin/mm/backup/database-export', {
      method: 'GET',
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error('Export failed')
    }

    const result = await response.json()
    if (result.code !== 0) {
      throw new Error(result.message)
    }

    // 下载 JSON 文件
    const blob = new Blob([JSON.stringify(result.data, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `database-backup-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(url)

    ElMessage.success(t('AdminMM.backup.messages.dbExportSuccess'))
  } catch (err: any) {
    console.error('Database export error:', err)
    ElMessage.error(err.message || t('AdminMM.backup.messages.dbExportFailed'))
  } finally {
    dbExporting.value = false
  }
}

async function importDatabase(file: File) {
  dbImporting.value = true
  try {
    const text = await file.text()
    const data = JSON.parse(text)

    const response = await fetch('/api/admin/mm/backup/database-import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        data: data.data || data,
        mode: importMode.value,
      }),
    })

    const result = await response.json()
    if (result.code !== 0) {
      throw new Error(result.message)
    }

    ElMessage.success(t('AdminMM.backup.messages.dbImportSuccess'))
  } catch (err: any) {
    console.error('Database import error:', err)
    ElMessage.error(err.message || t('AdminMM.backup.messages.dbImportFailed'))
  } finally {
    dbImporting.value = false
  }
}

function handleDbFileChange(file: UploadFile) {
  if (file.raw) {
    importDatabase(file.raw)
  }
  return false // 阻止自动上传
}

// ============ 文件系统备份/恢复 ============
async function exportFiles() {
  filesExporting.value = true
  try {
    const response = await fetch('/api/admin/mm/backup/files-export', {
      method: 'GET',
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error('Export failed')
    }

    // 下载 ZIP 文件
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `uploads-backup-${Date.now()}.zip`
    link.click()
    URL.revokeObjectURL(url)

    ElMessage.success(t('AdminMM.backup.messages.filesExportSuccess'))
  } catch (err: any) {
    console.error('Files export error:', err)
    ElMessage.error(err.message || t('AdminMM.backup.messages.filesExportFailed'))
  } finally {
    filesExporting.value = false
  }
}

async function importFiles(file: File) {
  filesImporting.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('mode', filesImportMode.value)

    const response = await fetch('/api/admin/mm/backup/files-import', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })

    const result = await response.json()
    if (result.code !== 0) {
      throw new Error(result.message)
    }

    ElMessage.success(t('AdminMM.backup.messages.filesImportSuccess'))
  } catch (err: any) {
    console.error('Files import error:', err)
    ElMessage.error(err.message || t('AdminMM.backup.messages.filesImportFailed'))
  } finally {
    filesImporting.value = false
  }
}

function handleFilesFileChange(file: UploadFile) {
  if (file.raw) {
    importFiles(file.raw)
  }
  return false // 阻止自动上传
}

// ============ 系统重置 ============
function openResetDialog() {
  resetDialogVisible.value = true
}

async function confirmReset() {
  try {
    await ElMessageBox.confirm(
      t('AdminMM.backup.reset.confirmMessage'),
      t('AdminMM.backup.reset.confirmTitle'),
      {
        confirmButtonText: t('AdminMM.backup.reset.confirmButton'),
        cancelButtonText: t('AdminMM.backup.reset.cancelButton'),
        type: 'error',
        confirmButtonClass: 'el-button--danger',
      }
    )

    await executeReset()
  } catch {
    // 用户取消
  }
}

async function executeReset() {
  resetting.value = true
  try {
    const response = await fetch('/api/admin/mm/backup/system-reset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        confirm: 'RESET_ALL_DATA',
        clearDatabase: resetOptions.value.clearDatabase,
        clearFiles: resetOptions.value.clearFiles,
      }),
    })

    const result = await response.json()
    if (result.code !== 0) {
      throw new Error(result.message)
    }

    resetDialogVisible.value = false
    ElMessage.success(t('AdminMM.backup.messages.resetSuccess'))
  } catch (err: any) {
    console.error('System reset error:', err)
    ElMessage.error(err.message || t('AdminMM.backup.messages.resetFailed'))
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <div class="page-container">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">{{ $t('AdminMM.backup.title') }}</h1>
        <p class="page-desc">{{ $t('AdminMM.backup.desc') }}</p>
      </div>
    </div>

    <!-- 警告提示 -->
    <el-alert
      :title="$t('AdminMM.backup.warning.title')"
      type="warning"
      :closable="false"
      show-icon
      class="warning-alert"
    >
      <template #default>
        <p>{{ $t('AdminMM.backup.warning.content') }}</p>
      </template>
    </el-alert>

    <!-- 数据库备份卡片 -->
    <div class="backup-card">
      <div class="card-header">
        <div class="header-icon">
          <DocumentTextIcon class="icon-lg" />
        </div>
        <div class="header-content">
          <h2 class="card-title">{{ $t('AdminMM.backup.database.title') }}</h2>
          <p class="card-desc">{{ $t('AdminMM.backup.database.desc') }}</p>
        </div>
      </div>

      <div class="card-body">
        <!-- 导出 -->
        <div class="action-section">
          <div class="section-label">
            <ArrowDownTrayIcon class="icon-sm" />
            {{ $t('AdminMM.backup.database.export') }}
          </div>
          <el-button
            type="primary"
            :loading="dbExporting"
            @click="exportDatabase"
          >
            <el-icon v-if="!dbExporting"><ArrowDownTrayIcon class="icon-sm" /></el-icon>
            {{ $t('AdminMM.backup.actions.exportDb') }}
          </el-button>
        </div>

        <!-- 导入 -->
        <div class="action-section">
          <div class="section-label">
            <ArrowUpTrayIcon class="icon-sm" />
            {{ $t('AdminMM.backup.database.import') }}
          </div>
          <div class="import-controls">
            <el-radio-group v-model="importMode" size="small">
              <el-radio-button value="insert">
                {{ $t('AdminMM.backup.mode.insert') }}
              </el-radio-button>
              <el-radio-button value="overwrite">
                {{ $t('AdminMM.backup.mode.overwrite') }}
              </el-radio-button>
            </el-radio-group>
            <el-upload
              :auto-upload="false"
              :show-file-list="false"
              :on-change="handleDbFileChange"
              accept=".json"
            >
              <el-button :loading="dbImporting">
                <el-icon v-if="!dbImporting"><ArrowUpTrayIcon class="icon-sm" /></el-icon>
                {{ $t('AdminMM.backup.actions.importDb') }}
              </el-button>
            </el-upload>
          </div>
        </div>
      </div>
    </div>

    <!-- 文件系统备份卡片 -->
    <div class="backup-card">
      <div class="card-header">
        <div class="header-icon">
          <FolderIcon class="icon-lg" />
        </div>
        <div class="header-content">
          <h2 class="card-title">{{ $t('AdminMM.backup.files.title') }}</h2>
          <p class="card-desc">{{ $t('AdminMM.backup.files.desc') }}</p>
        </div>
      </div>

      <div class="card-body">
        <!-- 导出 -->
        <div class="action-section">
          <div class="section-label">
            <ArrowDownTrayIcon class="icon-sm" />
            {{ $t('AdminMM.backup.files.export') }}
          </div>
          <el-button
            type="primary"
            :loading="filesExporting"
            @click="exportFiles"
          >
            <el-icon v-if="!filesExporting"><ArrowDownTrayIcon class="icon-sm" /></el-icon>
            {{ $t('AdminMM.backup.actions.exportFiles') }}
          </el-button>
        </div>

        <!-- 导入 -->
        <div class="action-section">
          <div class="section-label">
            <ArrowUpTrayIcon class="icon-sm" />
            {{ $t('AdminMM.backup.files.import') }}
          </div>
          <div class="import-controls">
            <el-radio-group v-model="filesImportMode" size="small">
              <el-radio-button value="insert">
                {{ $t('AdminMM.backup.mode.insert') }}
              </el-radio-button>
              <el-radio-button value="overwrite">
                {{ $t('AdminMM.backup.mode.overwrite') }}
              </el-radio-button>
            </el-radio-group>
            <el-upload
              :auto-upload="false"
              :show-file-list="false"
              :on-change="handleFilesFileChange"
              accept=".zip"
            >
              <el-button :loading="filesImporting">
                <el-icon v-if="!filesImporting"><ArrowUpTrayIcon class="icon-sm" /></el-icon>
                {{ $t('AdminMM.backup.actions.importFiles') }}
              </el-button>
            </el-upload>
          </div>
        </div>
      </div>
    </div>

    <!-- 系统重置卡片 -->
    <div class="backup-card danger-card">
      <div class="card-header">
        <div class="header-icon danger">
          <ExclamationTriangleIcon class="icon-lg" />
        </div>
        <div class="header-content">
          <h2 class="card-title">{{ $t('AdminMM.backup.reset.title') }}</h2>
          <p class="card-desc">{{ $t('AdminMM.backup.reset.desc') }}</p>
        </div>
      </div>

      <div class="card-body">
        <div class="action-section">
          <div class="section-label danger">
            <TrashIcon class="icon-sm" />
            {{ $t('AdminMM.backup.reset.action') }}
          </div>
          <el-button
            type="danger"
            :loading="resetting"
            @click="openResetDialog"
          >
            <el-icon v-if="!resetting"><TrashIcon class="icon-sm" /></el-icon>
            {{ $t('AdminMM.backup.actions.reset') }}
          </el-button>
        </div>
      </div>
    </div>

    <!-- 重置确认对话框 -->
    <el-dialog
      v-model="resetDialogVisible"
      :title="$t('AdminMM.backup.reset.dialogTitle')"
      width="500px"
      :close-on-click-modal="false"
    >
      <div class="reset-dialog-content">
        <el-alert
          :title="$t('AdminMM.backup.reset.dialogWarning')"
          type="error"
          :closable="false"
          show-icon
        />

        <div class="reset-options">
          <label class="reset-option">
            <input v-model="resetOptions.clearDatabase" type="checkbox" />
            <span>{{ $t('AdminMM.backup.reset.clearDatabase') }}</span>
          </label>
          <label class="reset-option">
            <input v-model="resetOptions.clearFiles" type="checkbox" />
            <span>{{ $t('AdminMM.backup.reset.clearFiles') }}</span>
          </label>
        </div>
      </div>

      <template #footer>
        <el-button @click="resetDialogVisible = false">
          {{ $t('AdminMM.backup.reset.cancelButton') }}
        </el-button>
        <el-button
          type="danger"
          :loading="resetting"
          :disabled="!resetOptions.clearDatabase && !resetOptions.clearFiles"
          @click="confirmReset"
        >
          {{ $t('AdminMM.backup.reset.confirmButton') }}
        </el-button>
      </template>
    </el-dialog>
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

/* 警告提示 */
.warning-alert {
  margin-bottom: 12px;
}

.warning-alert p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}

/* 备份卡片 */
.backup-card {
  margin-bottom: 12px;
  padding: 16px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
  backdrop-filter: blur(var(--sloth-blur));
}

.backup-card.danger-card {
  border-color: var(--sloth-danger-dim, rgba(239, 68, 68, 0.3));
}

.card-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--sloth-card-border);
}

.header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--sloth-radius);
  background: var(--sloth-primary-dim);
  color: var(--sloth-primary);
  flex-shrink: 0;
}

.header-icon.danger {
  background: var(--sloth-danger-dim, rgba(239, 68, 68, 0.1));
  color: var(--sloth-danger, #ef4444);
}

.header-content {
  flex: 1;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--sloth-text);
  margin: 0 0 4px;
}

.card-desc {
  font-size: 13px;
  color: var(--sloth-text-subtle);
  margin: 0;
  line-height: 1.5;
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 操作区域 */
.action-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  background: var(--sloth-bg);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
}

.section-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--sloth-text);
}

.section-label.danger {
  color: var(--sloth-danger, #ef4444);
}

.import-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 图标尺寸 */
.icon-sm {
  width: 16px;
  height: 16px;
}

.icon-lg {
  width: 24px;
  height: 24px;
}

/* 重置对话框 */
.reset-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.reset-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background: var(--sloth-bg);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
}

.reset-option {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--sloth-text);
  cursor: pointer;
}

.reset-option input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

/* Element Plus 主题适配 */
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

:deep(.el-button--danger) {
  --el-button-bg-color: var(--sloth-danger, #ef4444);
  --el-button-border-color: var(--sloth-danger, #ef4444);
  --el-button-hover-bg-color: var(--sloth-danger-hover, #dc2626);
  --el-button-hover-border-color: var(--sloth-danger-hover, #dc2626);
}

:deep(.el-button--default) {
  --el-button-bg-color: var(--sloth-bg);
  --el-button-text-color: var(--sloth-text);
  --el-button-border-color: var(--sloth-card-border);
  --el-button-hover-bg-color: var(--sloth-bg-hover);
  --el-button-hover-text-color: var(--sloth-primary);
  --el-button-hover-border-color: var(--sloth-primary);
}

/* Radio Button 主题适配 */
:deep(.el-radio-group) {
  --el-radio-button-checked-bg-color: var(--sloth-primary);
  --el-radio-button-checked-border-color: var(--sloth-primary);
  --el-radio-button-checked-text-color: #fff;
}

:deep(.el-radio-button__inner) {
  background-color: var(--sloth-bg);
  border-color: var(--sloth-card-border);
  color: var(--sloth-text);
  font-size: 13px;
  padding: 6px 12px;
}

:deep(.el-radio-button__inner:hover) {
  color: var(--sloth-primary);
}

:deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  background-color: var(--sloth-primary);
  border-color: var(--sloth-primary);
  color: #fff;
}

/* Alert 主题适配 */
:deep(.el-alert--warning) {
  --el-alert-bg-color: rgba(245, 158, 11, 0.1);
  background-color: rgba(245, 158, 11, 0.1);
  border: 1px solid var(--sloth-card-border);
}

:deep(.el-alert--error) {
  --el-alert-bg-color: rgba(239, 68, 68, 0.1);
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

:deep(.el-alert__title) {
  color: var(--sloth-text);
  font-size: 13px;
}

:deep(.el-alert__description) {
  color: var(--sloth-text-subtle);
}

/* Dialog 主题适配 */
:deep(.el-dialog) {
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
}

:deep(.el-dialog__header) {
  border-bottom: 1px solid var(--sloth-card-border);
}

:deep(.el-dialog__title) {
  color: var(--sloth-text);
  font-size: 14px;
}

:deep(.el-dialog__body) {
  color: var(--sloth-text);
}

/* Upload 隐藏样式 */
:deep(.el-upload) {
  display: inline-block;
}

@media (max-width: 960px) {
  .action-section {
    flex-direction: column;
    align-items: flex-start;
  }

  .import-controls {
    width: 100%;
    flex-direction: column;
  }

  .import-controls .el-radio-group,
  .import-controls .el-upload {
    width: 100%;
  }

  .import-controls .el-button {
    width: 100%;
  }
}
</style>
