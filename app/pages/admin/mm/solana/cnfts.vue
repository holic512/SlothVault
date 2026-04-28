<script setup lang="ts">
/**
 * cNFT 管理页面
 * 
 * 功能：
 * - cNFT 列表展示
 * - 按项目、状态、持有者、网络筛选
 * - 分页
 * - 铸造 cNFT
 * - 删除失败/铸造中的记录
 * 
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import { 
  ArrowPathIcon, 
  SparklesIcon,
} from '@heroicons/vue/24/outline'
import MintCnftDialog from '~/components/admin/mm/solana/MintCnftDialog.vue'

const { t } = useI18n()

// ============ 类型定义 ============
interface ProjectItem {
  id: string
  projectName: string
  avatar: string | null
}

interface CnftItem {
  id: string
  projectId: string
  projectName: string | null
  projectAvatar: string | null
  assetId: string
  leafIndex: number
  name: string
  symbol: string | null
  metadataUri: string | null
  ownerAddress: string
  mintTxSignature: string | null
  status: number
  createdAt: string
  updatedAt: string
  merkleTree: {
    name: string
    treeAddress: string
    network: string
  }
}

// 从父组件注入网络状态
const currentNetwork = inject<Ref<'mainnet' | 'devnet'>>('solanaNetwork', ref('devnet'))

// ============ 状态管理 ============
// cNFT 列表
const cnfts = ref<CnftItem[]>([])
const cnftLoading = ref(false)
const cnftTotal = ref(0)

// cNFT 分页 (Requirement 8.5)
const cnftPage = ref(1)
const cnftPageSize = ref(20)

// cNFT 筛选 (Requirements 8.2, 8.3, 8.4)
const cnftFilters = ref({
  projectId: '',
  status: '' as '' | '0' | '1' | '-1',
  ownerAddress: '',
})

// 项目列表（用于筛选）
const projects = ref<ProjectItem[]>([])
const projectLoading = ref(false)

// 铸造弹窗
const showMintDialog = ref(false)

// ============ 方法 ============
// 获取项目列表（用于筛选）
async function fetchProjects() {
  projectLoading.value = true
  try {
    const res = await $fetch<{
      code: number
      data: { list: ProjectItem[]; total: number }
    }>('/api/admin/mm/project', {
      query: { pageSize: 100, status: 1 },
    })
    if (res.code === 0) {
      projects.value = res.data.list
    }
  } catch (err) {
    console.error(t('AdminMM.solana.cnfts.messages.fetchProjectsFailed'), err)
  } finally {
    projectLoading.value = false
  }
}

// 获取 cNFT 列表 (Requirement 8.1)
async function fetchCnfts() {
  cnftLoading.value = true
  try {
    const query: Record<string, any> = {
      page: cnftPage.value,
      pageSize: cnftPageSize.value,
      network: currentNetwork.value, // 按网络筛选
    }
    
    // 添加筛选条件 (Requirements 8.2, 8.3, 8.4)
    if (cnftFilters.value.projectId) {
      query.projectId = cnftFilters.value.projectId
    }
    if (cnftFilters.value.status !== '') {
      query.status = cnftFilters.value.status
    }
    if (cnftFilters.value.ownerAddress) {
      query.ownerAddress = cnftFilters.value.ownerAddress
    }

    const res = await $fetch<{
      code: number
      data: {
        list: CnftItem[]
        total: number
        page: number
        pageSize: number
      }
    }>('/api/admin/solana/cnft', { query })

    if (res.code === 0) {
      cnfts.value = res.data.list
      cnftTotal.value = res.data.total
    }
  } catch (err) {
    console.error(t('AdminMM.solana.cnfts.messages.fetchCnftsFailed'), err)
    ElMessage.error(t('AdminMM.solana.cnfts.messages.fetchCnftsFailed'))
  } finally {
    cnftLoading.value = false
  }
}

// 筛选变化时重新获取列表
function handleCnftFilterChange() {
  cnftPage.value = 1
  fetchCnfts()
}

// 分页变化 (Requirement 8.5)
function handleCnftPageChange(page: number) {
  cnftPage.value = page
  fetchCnfts()
}

function handleCnftPageSizeChange(size: number) {
  cnftPageSize.value = size
  cnftPage.value = 1
  fetchCnfts()
}

// 重置筛选
function resetCnftFilters() {
  cnftFilters.value = {
    projectId: '',
    status: '',
    ownerAddress: '',
  }
  cnftPage.value = 1
  fetchCnfts()
}

// 打开铸造弹窗
function openMintDialog() {
  showMintDialog.value = true
}

// 铸造成功回调
function handleMintSuccess(_cnft: any) {
  fetchCnfts()
}

// 格式化 cNFT 状态
function formatCnftStatus(status: number): string {
  const map: Record<number, string> = {
    0: t('AdminMM.solana.cnfts.status.minting'),
    1: t('AdminMM.solana.cnfts.status.normal'),
    [-1]: t('AdminMM.solana.cnfts.status.failed'),
  }
  return map[status] || t('AdminMM.solana.cnfts.status.unknown')
}

// cNFT 状态标签类型
function cnftStatusType(status: number): string {
  const map: Record<number, string> = {
    0: 'warning',
    1: 'success',
    [-1]: 'danger',
  }
  return map[status] || 'info'
}

// 网络标签类型
function networkType(network: string): string {
  return network === 'mainnet' ? 'success' : 'warning'
}

// 格式化网络名称
function formatNetwork(network: string): string {
  return network === 'mainnet' ? t('AdminMM.solana.cnfts.network.mainnet') : t('AdminMM.solana.cnfts.network.devnet')
}

// 格式化时间
function formatTime(dateStr: string): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// 删除 cNFT 记录（只能删除铸造中或失败的）
async function deleteCnft(cnft: CnftItem) {
  const statusText = cnft.status === 0 ? t('AdminMM.solana.cnfts.status.minting') : t('AdminMM.solana.cnfts.status.failed')
  try {
    await ElMessageBox.confirm(
      t('AdminMM.solana.cnfts.messages.deleteConfirm', {
        status: statusText,
        name: cnft.name,
        owner: `${cnft.ownerAddress.slice(0, 8)}...${cnft.ownerAddress.slice(-8)}`
      }),
      t('AdminMM.solana.cnfts.messages.deleteConfirmTitle'),
      { 
        confirmButtonText: t('AdminMM.solana.cnfts.messages.deleteButton'), 
        cancelButtonText: t('AdminMM.solana.cnfts.messages.cancelButton'), 
        type: 'warning' 
      }
    )
  } catch {
    return
  }

  try {
    const res = await $fetch<{ code: number; message: string }>(
      `/api/admin/solana/cnft/${cnft.id}`,
      { method: 'DELETE' }
    )
    if (res.code === 0) {
      ElMessage.success(res.message)
      fetchCnfts()
    }
  } catch (err: any) {
    ElMessage.error(err.data?.message || err.message || t('AdminMM.solana.cnfts.messages.deleteFailed'))
  }
}

// ============ 生命周期 ============
onMounted(async () => {
  await fetchProjects()
  await fetchCnfts()
})

// 监听网络变化，重新获取数据
watch(currentNetwork, () => {
  cnftPage.value = 1
  fetchCnfts()
})
</script>

<template>
  <div class="cnfts-page">
    <!-- 操作栏 -->
    <div class="action-bar">
      <el-button type="primary" @click="openMintDialog">
        <el-icon><SparklesIcon /></el-icon>
        {{ $t('AdminMM.solana.cnfts.actions.mint') }}
      </el-button>
      <el-button @click="fetchCnfts" :loading="cnftLoading">
        <el-icon><ArrowPathIcon /></el-icon>
        {{ $t('AdminMM.solana.cnfts.actions.refresh') }}
      </el-button>
    </div>

    <!-- 筛选栏 (Requirements 8.2, 8.3, 8.4) -->
    <div class="filter-bar">
      <el-select
        v-model="cnftFilters.projectId"
        :placeholder="$t('AdminMM.solana.cnfts.filters.byProject')"
        clearable
        filterable
        :loading="projectLoading"
        style="width: 200px"
        @change="handleCnftFilterChange"
      >
        <el-option
          v-for="project in projects"
          :key="project.id"
          :label="project.projectName"
          :value="project.id"
        >
          <div class="project-option">
            <img v-if="project.avatar" :src="project.avatar" class="project-avatar" />
            <span>{{ project.projectName }}</span>
          </div>
        </el-option>
      </el-select>

      <el-select
        v-model="cnftFilters.status"
        :placeholder="$t('AdminMM.solana.cnfts.filters.byStatus')"
        clearable
        style="width: 140px"
        @change="handleCnftFilterChange"
      >
        <el-option :label="$t('AdminMM.solana.cnfts.status.minting')" value="0" />
        <el-option :label="$t('AdminMM.solana.cnfts.status.normal')" value="1" />
        <el-option :label="$t('AdminMM.solana.cnfts.status.failed')" value="-1" />
      </el-select>

      <el-input
        v-model="cnftFilters.ownerAddress"
        :placeholder="$t('AdminMM.solana.cnfts.filters.searchOwner')"
        clearable
        style="width: 280px"
        @clear="handleCnftFilterChange"
        @keyup.enter="handleCnftFilterChange"
      >
        <template #append>
          <el-button @click="handleCnftFilterChange">{{ $t('AdminMM.solana.cnfts.filters.search') }}</el-button>
        </template>
      </el-input>

      <el-button @click="resetCnftFilters">{{ $t('AdminMM.solana.cnfts.filters.reset') }}</el-button>

      <!-- 当前网络提示 -->
      <div class="network-hint">
        <el-tag :type="networkType(currentNetwork)" size="small">
          {{ formatNetwork(currentNetwork) }}
        </el-tag>
      </div>
    </div>

    <!-- cNFT 列表 (Requirement 8.1) -->
    <div class="cnft-list">
      <el-table :data="cnfts" v-loading="cnftLoading" stripe>
        <el-table-column :label="$t('AdminMM.solana.cnfts.table.nftInfo')" min-width="200">
          <template #default="{ row }">
            <div class="cnft-info">
              <span class="cnft-name">{{ row.name }}</span>
              <span v-if="row.symbol" class="cnft-symbol">{{ row.symbol }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="$t('AdminMM.solana.cnfts.table.project')" min-width="140">
          <template #default="{ row }">
            <div class="project-cell">
              <img v-if="row.projectAvatar" :src="row.projectAvatar" class="project-avatar" />
              <span>{{ row.projectName || '-' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="$t('AdminMM.solana.cnfts.table.owner')" min-width="180">
          <template #default="{ row }">
            <span class="address-text" :title="row.ownerAddress">
              {{ row.ownerAddress.slice(0, 6) }}...{{ row.ownerAddress.slice(-6) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('AdminMM.solana.cnfts.table.merkleTree')" min-width="160">
          <template #default="{ row }">
            <div class="tree-cell">
              <span class="tree-name">{{ row.merkleTree?.name || '-' }}</span>
              <el-tag :type="networkType(row.merkleTree?.network)" size="small" class="network-tag">
                {{ formatNetwork(row.merkleTree?.network) }}
              </el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="$t('AdminMM.solana.cnfts.table.leafIndex')" width="100">
          <template #default="{ row }">
            <span>{{ row.leafIndex }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('AdminMM.solana.cnfts.table.status')" width="100">
          <template #default="{ row }">
            <el-tag :type="cnftStatusType(row.status)" size="small">
              {{ formatCnftStatus(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('AdminMM.solana.cnfts.table.mintTime')" width="160">
          <template #default="{ row }">
            <span class="time-text">{{ formatTime(row.createdAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('AdminMM.solana.cnfts.table.assetId')" min-width="180">
          <template #default="{ row }">
            <span v-if="row.assetId && !row.assetId.startsWith('pending_')" class="address-text" :title="row.assetId">
              {{ row.assetId.slice(0, 6) }}...{{ row.assetId.slice(-6) }}
            </span>
            <span v-else class="text-subtle">-</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('AdminMM.solana.cnfts.table.operations')" width="100" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 0 || row.status === -1"
              type="danger"
              link
              size="small"
              @click="deleteCnft(row)"
            >
              {{ $t('AdminMM.solana.cnfts.operations.delete') }}
            </el-button>
            <span v-else class="text-subtle">-</span>
          </template>
        </el-table-column>
      </el-table>

      <!-- 空状态 -->
      <div v-if="!cnftLoading && cnfts.length === 0" class="empty-state">
        <p>{{ $t('AdminMM.solana.cnfts.empty.title') }}</p>
        <p class="empty-hint">{{ $t('AdminMM.solana.cnfts.empty.hint') }}</p>
        <el-button type="primary" @click="openMintDialog">{{ $t('AdminMM.solana.cnfts.empty.mintFirst') }}</el-button>
      </div>

      <!-- 分页 (Requirement 8.5) -->
      <div v-if="cnftTotal > 0" class="pagination-container">
        <el-pagination
          v-model:current-page="cnftPage"
          v-model:page-size="cnftPageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="cnftTotal"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleCnftPageSizeChange"
          @current-change="handleCnftPageChange"
        />
      </div>
    </div>

    <!-- 铸造 cNFT 弹窗 -->
    <MintCnftDialog
      v-model="showMintDialog"
      :network="currentNetwork"
      @success="handleMintSuccess"
    />
  </div>
</template>


<style scoped>
.cnfts-page {
  --sloth-radius: 4px;
}

/* 操作栏卡片 */
.action-bar {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
  padding: 12px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
  backdrop-filter: blur(var(--sloth-blur));
}

/* 筛选栏 */
.filter-bar {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 12px;
  padding: 12px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
  backdrop-filter: blur(var(--sloth-blur));
}

.network-hint {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--sloth-text-subtle);
}

/* cNFT 列表卡片 */
.cnft-list {
  padding: 12px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
  backdrop-filter: blur(var(--sloth-blur));
}

/* cNFT 列表样式 */
.cnft-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cnft-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--sloth-text);
}

.cnft-symbol {
  font-size: 11px;
  color: var(--sloth-text-subtle);
  font-family: var(--sloth-font-mono, monospace);
}

.project-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.project-option {
  display: flex;
  align-items: center;
  gap: 8px;
}

.project-avatar {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  object-fit: cover;
}

.tree-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tree-name {
  font-size: 12px;
  color: var(--sloth-text);
}

.network-tag {
  width: fit-content;
}

.address-text {
  font-size: 12px;
  font-family: var(--sloth-font-mono, monospace);
  color: var(--sloth-text-subtle);
  cursor: pointer;
}

.address-text:hover {
  color: var(--sloth-primary);
}

.time-text {
  font-size: 12px;
  color: var(--sloth-text-subtle);
}

/* 分页容器 */
.pagination-container {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--sloth-card-border);
}

.empty-state {
  padding: 48px;
  text-align: center;
  color: var(--sloth-text-subtle);
}

.empty-state p {
  margin-bottom: 8px;
  font-size: 13px;
}

.empty-hint {
  font-size: 12px;
  margin-bottom: 16px !important;
}

.text-subtle {
  color: var(--sloth-text-subtle);
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

:deep(.el-input-group__append) {
  background-color: var(--sloth-bg-hover);
  border-color: var(--sloth-card-border);
  color: var(--sloth-text);
  box-shadow: none;
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

:deep(.el-button--small) {
  padding: 4px 8px;
  font-size: 12px;
  height: 26px;
}

/* 表格主题适配 */
:deep(.el-table) {
  --el-table-bg-color: var(--sloth-card);
  --el-table-tr-bg-color: var(--sloth-card);
  --el-table-header-bg-color: var(--sloth-bg-hover);
  --el-table-header-text-color: var(--sloth-text);
  --el-table-text-color: var(--sloth-text);
  --el-table-border-color: var(--sloth-card-border);
  --el-table-row-hover-bg-color: var(--sloth-bg-hover);
  font-size: 13px;
  background-color: var(--sloth-card);
}

:deep(.el-table__inner-wrapper) {
  background-color: var(--sloth-card);
}

:deep(.el-table th.el-table__cell) {
  padding: 8px 0;
  font-size: 13px;
  font-weight: 600;
  background-color: var(--sloth-bg-hover);
}

:deep(.el-table td.el-table__cell) {
  padding: 6px 0;
  background-color: var(--sloth-card);
}

/* 斑马纹适配暗黑模式 */
:deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) {
  background-color: var(--sloth-bg);
}

:deep(.el-table--enable-row-hover .el-table__body tr:hover > td.el-table__cell) {
  background-color: var(--sloth-bg-hover);
}

:deep(.el-table__fixed-right) {
  background-color: var(--sloth-card);
}

:deep(.el-table__fixed-right .el-table__cell) {
  background-color: var(--sloth-card);
}

:deep(.el-table__fixed-right-patch) {
  background-color: var(--sloth-bg-hover);
}

:deep(.el-table__empty-block) {
  background-color: var(--sloth-card);
}

:deep(.el-table__empty-text) {
  color: var(--sloth-text-subtle);
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

:deep(.el-tag--danger) {
  --el-tag-bg-color: rgba(239, 68, 68, 0.1);
  --el-tag-border-color: rgba(239, 68, 68, 0.2);
  --el-tag-text-color: #ef4444;
}

/* Select 主题适配 */
:deep(.el-select) {
  --el-select-border-color-hover: var(--sloth-primary);
}

:deep(.el-select .el-input__wrapper) {
  background-color: var(--sloth-bg);
  box-shadow: 0 0 0 1px var(--sloth-card-border) inset;
}

:deep(.el-select .el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--sloth-primary) inset;
}

:deep(.el-select .el-input.is-focus .el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--sloth-primary) inset;
}

/* Pagination 主题适配 */
:deep(.el-pagination) {
  --el-pagination-bg-color: var(--sloth-bg);
  --el-pagination-text-color: var(--sloth-text);
  --el-pagination-button-color: var(--sloth-text);
  --el-pagination-button-bg-color: var(--sloth-bg);
  --el-pagination-button-disabled-color: var(--sloth-text-subtle);
  --el-pagination-button-disabled-bg-color: var(--sloth-bg);
  --el-pagination-hover-color: var(--sloth-primary);
}

:deep(.el-pagination .el-input__wrapper) {
  background-color: var(--sloth-bg);
}

:deep(.el-pager li) {
  background-color: var(--sloth-bg);
  color: var(--sloth-text);
}

:deep(.el-pager li:hover) {
  color: var(--sloth-primary);
}

:deep(.el-pager li.is-active) {
  color: var(--sloth-primary);
  font-weight: 600;
}

/* Loading 适配 */
:deep(.el-loading-mask) {
  background-color: rgba(var(--sloth-primary-rgb), 0.05);
}

:deep(.el-loading-spinner .circular) {
  stroke: var(--sloth-primary);
}

:deep(.el-loading-text) {
  color: var(--sloth-text-subtle);
}

/* Select 下拉面板适配（全局样式需在 main.css 中处理） */
:deep(.el-select__popper) {
  --el-bg-color-overlay: var(--sloth-card);
  --el-border-color-light: var(--sloth-card-border);
  --el-text-color-regular: var(--sloth-text);
}

@media (max-width: 960px) {
  .filter-bar {
    flex-direction: column;
    align-items: stretch;
  }

  .filter-bar .el-select,
  .filter-bar .el-input {
    width: 100% !important;
  }

  .network-hint {
    margin-left: 0;
    margin-top: 8px;
  }
}
</style>
