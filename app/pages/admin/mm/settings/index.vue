<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import {
  ElButton,
  ElForm,
  ElFormItem,
  ElInput,
  ElMessage,
  ElAlert,
  ElIcon,
} from 'element-plus'
import { ArrowPathIcon, CheckIcon } from '@heroicons/vue/24/outline'

definePageMeta({
  layout: 'admin-mm',
})

const { t } = useI18n()
const router = useRouter()
const { setPageTitle } = usePageTitle()

// 设置页面标题
setPageTitle('adminSettings')

type ApiResponse<T> = {
  code: number
  message: string
  data: T
}

type ConfigItem = {
  key: string
  value: string
  description: string
  defaultValue: string
}

type ConfigGroup = {
  key: string
  label: string
  configs: ConfigItem[]
}

type ConfigData = {
  configs: ConfigItem[]
  groups: ConfigGroup[]
}

const loading = ref(false)
const saving = ref(false)
const refreshing = ref(false)

const groups = ref<ConfigGroup[]>([])
const formData = reactive<Record<string, string>>({})
const originalData = reactive<Record<string, string>>({})

// 是否有未保存的更改
const hasChanges = computed(() => {
  return Object.keys(formData).some((key) => formData[key] !== originalData[key])
})

async function apiFetch<T>(url: string, options?: any): Promise<T> {
  const res = await $fetch<ApiResponse<T>>(url, options)
  if (res?.code === 0) return res.data
  if (res?.code === 401) {
    await router.push('/admin/auth/login')
    throw new Error('Unauthorized')
  }
  throw new Error(res?.message || t('AdminMM.settings.messages.requestFailed'))
}

async function fetchConfigs() {
  loading.value = true
  try {
    const data = await apiFetch<ConfigData>('/api/admin/mm/config', {
      method: 'GET',
    })

    groups.value = data.groups

    // 初始化表单数据
    for (const config of data.configs) {
      formData[config.key] = config.value
      originalData[config.key] = config.value
    }
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || t('AdminMM.settings.messages.loadFailed'))
    }
  } finally {
    loading.value = false
  }
}

async function saveConfigs() {
  saving.value = true
  try {
    const configs = Object.entries(formData).map(([key, value]) => ({
      key,
      value,
    }))

    await apiFetch<{ updated: number }>('/api/admin/mm/config', {
      method: 'PUT',
      body: { configs },
    })

    // 更新原始数据
    for (const key of Object.keys(formData)) {
      originalData[key] = formData[key]
    }

    ElMessage.success(t('AdminMM.settings.messages.saveSuccess'))
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || t('AdminMM.settings.messages.saveFailed'))
    }
  } finally {
    saving.value = false
  }
}

async function refreshCache() {
  refreshing.value = true
  try {
    await apiFetch<{ message: string }>('/api/admin/mm/config/refresh', {
      method: 'POST',
    })

    ElMessage.success(t('AdminMM.settings.messages.refreshSuccess'))
  } catch (e: any) {
    if (e?.message !== 'Unauthorized') {
      ElMessage.error(e?.message || t('AdminMM.settings.messages.refreshFailed'))
    }
  } finally {
    refreshing.value = false
  }
}

function resetForm() {
  for (const key of Object.keys(originalData)) {
    formData[key] = originalData[key]
  }
}

// 判断是否是敏感字段（需要隐藏显示）
function isSensitiveField(key: string): boolean {
  return key.includes('SECRET') || key.includes('KEY')
}

// 获取分组的图标
function getGroupIcon(groupKey: string): string {
  const icons: Record<string, string> = {
    solana: '🔗',
    filebase: '📦',
  }
  return icons[groupKey] || '⚙️'
}

onMounted(() => {
  fetchConfigs()
})
</script>

<template>
  <div class="page-container">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">{{ $t('AdminMM.settings.title') }}</h1>
        <p class="page-desc">{{ $t('AdminMM.settings.desc') }}</p>
      </div>
    </div>

    <!-- 操作提示 -->
    <el-alert
      :title="$t('AdminMM.settings.tips.title')"
      type="info"
      :closable="false"
      show-icon
      class="tips-alert"
    >
      <template #default>
        <p>{{ $t('AdminMM.settings.tips.content') }}</p>
      </template>
    </el-alert>

    <!-- 工具栏 -->
    <div class="toolbar">
      <div class="actions">
        <el-button
          type="primary"
          :loading="saving"
          :disabled="!hasChanges"
          @click="saveConfigs"
        >
          <el-icon v-if="!saving"><CheckIcon class="icon-sm" /></el-icon>
          {{ $t('AdminMM.settings.actions.save') }}
        </el-button>
        <el-button
          :loading="refreshing"
          @click="refreshCache"
        >
          <el-icon v-if="!refreshing"><ArrowPathIcon class="icon-sm" /></el-icon>
          {{ $t('AdminMM.settings.actions.refresh') }}
        </el-button>
        <el-button
          :disabled="!hasChanges"
          @click="resetForm"
        >
          {{ $t('AdminMM.settings.actions.reset') }}
        </el-button>
      </div>
      <div v-if="hasChanges" class="unsaved-hint">
        <span class="hint-dot"></span>
        {{ $t('AdminMM.settings.unsavedChanges') }}
      </div>
    </div>

    <!-- 配置分组 -->
    <div v-loading="loading" class="config-groups">
      <div v-for="group in groups" :key="group.key" class="config-group">
        <div class="group-header">
          <span class="group-icon">{{ getGroupIcon(group.key) }}</span>
          <span class="group-label">{{ $t(`AdminMM.settings.groups.${group.key}`) }}</span>
        </div>

        <el-form label-position="top" class="config-form">
          <el-form-item
            v-for="config in group.configs"
            :key="config.key"
            :label="config.key"
          >
            <template #label>
              <div class="form-label">
                <span class="label-key">{{ config.key }}</span>
                <span class="label-desc">{{ $t(`AdminMM.settings.configDesc.${config.key}`) }}</span>
              </div>
            </template>
            <el-input
              v-model="formData[config.key]"
              :type="isSensitiveField(config.key) ? 'password' : 'text'"
              :show-password="isSensitiveField(config.key)"
              :placeholder="config.defaultValue || $t('AdminMM.settings.placeholder')"
              clearable
            />
          </el-form-item>
        </el-form>
      </div>

      <!-- 空状态 -->
      <div v-if="!loading && groups.length === 0" class="empty-state">
        <p>{{ $t('AdminMM.settings.empty') }}</p>
      </div>
    </div>
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

/* 提示信息 */
.tips-alert {
  margin-bottom: 12px;
}

.tips-alert p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}

/* 工具栏卡片 */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 12px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
  backdrop-filter: blur(var(--sloth-blur));
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.unsaved-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--sloth-danger, #ef4444);
}

.hint-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--sloth-danger, #ef4444);
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.icon-sm {
  width: 16px;
  height: 16px;
}

/* 配置分组 */
.config-groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.config-group {
  padding: 16px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
  backdrop-filter: blur(var(--sloth-blur));
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--sloth-card-border);
}

.group-icon {
  font-size: 18px;
}

.group-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--sloth-text);
}

.config-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 16px;
}

.form-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.label-key {
  font-size: 13px;
  font-weight: 600;
  color: var(--sloth-text);
  font-family: var(--sloth-font-mono, monospace);
}

.label-desc {
  font-size: 12px;
  color: var(--sloth-text-subtle);
  font-weight: 400;
}

/* 空状态 */
.empty-state {
  padding: 40px;
  text-align: center;
  color: var(--sloth-text-subtle);
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
}

.empty-state p {
  margin: 0;
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
  height: 32px;
  line-height: 32px;
  font-size: 13px;
  color: var(--sloth-text);
}

:deep(.el-input__inner::placeholder) {
  color: var(--sloth-text-subtle);
}

:deep(.el-form-item) {
  margin-bottom: 0;
}

:deep(.el-form-item__label) {
  font-size: 13px;
  padding-bottom: 4px;
  color: var(--sloth-text);
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

:deep(.el-button--default) {
  --el-button-bg-color: var(--sloth-bg);
  --el-button-text-color: var(--sloth-text);
  --el-button-border-color: var(--sloth-card-border);
  --el-button-hover-bg-color: var(--sloth-bg-hover);
  --el-button-hover-text-color: var(--sloth-primary);
  --el-button-hover-border-color: var(--sloth-primary);
}

/* Alert 主题适配 */
:deep(.el-alert--info) {
  --el-alert-bg-color: var(--sloth-primary-dim);
  background-color: var(--sloth-primary-dim);
  border: 1px solid var(--sloth-card-border);
}

:deep(.el-alert__title) {
  color: var(--sloth-text);
  font-size: 13px;
}

:deep(.el-alert__description) {
  color: var(--sloth-text-subtle);
}

@media (max-width: 960px) {
  .config-form {
    grid-template-columns: 1fr;
  }

  .toolbar {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
