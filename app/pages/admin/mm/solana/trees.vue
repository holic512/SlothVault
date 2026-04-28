<script setup lang="ts">
/**
 * Merkle Tree 管理页面
 * 
 * 功能：
 * - 系统级 cNFT Merkle Tree 管理
 * - 树列表展示和统计
 * - 创建树（通过 CreateTreeDialog 组件）
 * - 验证/删除树
 * 
 * Requirements: 7.3, 8.1, 9.1, 9.2, 9.3, 9.5
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import { 
  PlusIcon, 
  ArrowPathIcon, 
  EyeIcon, 
  ExclamationTriangleIcon,
} from '@heroicons/vue/24/outline'
import CreateTreeDialog from '~/components/admin/mm/solana/CreateTreeDialog.vue'
import TreeDetailDialog from '~/components/admin/mm/solana/TreeDetailDialog.vue'

const { t } = useI18n()

// 接收父组件传递的 network
const props = defineProps<{
  network: 'mainnet' | 'devnet'
}>()

// 从父组件注入网络状态
const currentNetwork = inject<Ref<'mainnet' | 'devnet'>>('solanaNetwork', ref('devnet'))

// ============ 状态管理 ============
// 树列表
const trees = ref<any[]>([])
const treeLoading = ref(false)

// 创建树弹窗（Requirements 7.3, 7.4）
const showCreateDialog = ref(false)

// 详情弹窗
const showDetailDialog = ref(false)
const currentTree = ref<any>(null)

// ============ 计算属性 ============
// 系统容量统计（Requirements 9.2）
const systemStats = computed(() => {
  const activeTrees = trees.value.filter(t => t.status === 1)
  const totalCapacity = activeTrees.reduce((sum, t) => sum + Number(t.maxCapacity), 0)
  const totalMinted = activeTrees.reduce((sum, t) => sum + t.mintedCount, 0)
  const availableCapacity = totalCapacity - totalMinted
  const usagePercent = totalCapacity > 0 ? ((totalMinted / totalCapacity) * 100).toFixed(1) : '0'
  
  // Requirements 9.3: 容量警告阈值
  const needMoreTrees = availableCapacity < 1000 || activeTrees.length === 0
  
  return {
    treeCount: activeTrees.length,
    totalCapacity,
    totalMinted,
    availableCapacity,
    usagePercent,
    needMoreTrees,
  }
})

// ============ 方法 ============
// 获取树列表（Requirements 9.1, 9.4）
async function fetchTrees() {
  treeLoading.value = true
  try {
    const res = await $fetch<{ code: number; data: any[] }>('/api/admin/solana/tree', {
      query: { network: currentNetwork.value },
    })
    if (res.code === 0) {
      trees.value = res.data
    }
  } catch (err) {
    console.error(t('AdminMM.solana.trees.messages.fetchFailed'), err)
  } finally {
    treeLoading.value = false
  }
}

// 打开创建弹窗（Requirements 7.3）
function openCreateDialog() {
  showCreateDialog.value = true
}

// 创建成功回调（Requirements 7.5）
function handleCreateSuccess(_tree: any) {
  fetchTrees()
}

// 打开详情弹窗
function openDetailDialog(tree: any) {
  currentTree.value = tree
  showDetailDialog.value = true
}

// 验证树状态（Requirements 8.1-8.5）
async function verifyTree(treeId: string) {
  try {
    const res = await $fetch<{ code: number; data: { status: number; message: string } }>(
      `/api/admin/solana/tree/${treeId}/verify`,
      { method: 'POST' }
    )
    if (res.code === 0) {
      ElMessage.success(res.data.message)
      fetchTrees()
    }
  } catch (err: any) {
    ElMessage.error(err.message || t('AdminMM.solana.trees.messages.verifyFailed'))
  }
}

// 删除树记录（Requirements 9.5）
async function deleteTree(tree: any) {
  try {
    await ElMessageBox.confirm(
      t('AdminMM.solana.trees.messages.deleteConfirm', { name: tree.name }),
      t('AdminMM.solana.trees.messages.deleteConfirmTitle'),
      { 
        confirmButtonText: t('AdminMM.solana.trees.messages.deleteButton'), 
        cancelButtonText: t('AdminMM.solana.trees.messages.cancelButton'), 
        type: 'warning' 
      }
    )
  } catch {
    return
  }

  try {
    const res = await $fetch<{ code: number; message: string }>(
      `/api/admin/solana/tree/${tree.id}`,
      { method: 'DELETE' }
    )
    if (res.code === 0) {
      ElMessage.success(res.message)
      fetchTrees()
    }
  } catch (err: any) {
    ElMessage.error(err.message || t('AdminMM.solana.trees.messages.deleteFailed'))
  }
}

// ============ 格式化函数 ============
// 格式化容量
function formatCapacity(capacity: number): string {
  if (capacity >= 1_000_000_000) return `${(capacity / 1_000_000_000).toFixed(1)}B`
  if (capacity >= 1_000_000) return `${(capacity / 1_000_000).toFixed(1)}M`
  if (capacity >= 1_000) return `${(capacity / 1_000).toFixed(1)}K`
  return capacity.toString()
}

// 格式化状态
function formatStatus(status: number): string {
  const map: Record<number, string> = {
    0: t('AdminMM.solana.trees.status.creating'),
    1: t('AdminMM.solana.trees.status.normal'),
    2: t('AdminMM.solana.trees.status.full'),
    [-1]: t('AdminMM.solana.trees.status.failed'),
  }
  return map[status] || t('AdminMM.solana.trees.status.unknown')
}

// 状态标签类型
function statusType(status: number): string {
  const map: Record<number, string> = {
    0: 'warning',
    1: 'success',
    2: 'info',
    [-1]: 'danger',
  }
  return map[status] || 'info'
}

// 计算树使用率
function getTreeUsage(tree: any): number {
  const capacity = Number(tree.maxCapacity)
  if (capacity === 0) return 0
  return (tree.mintedCount / capacity) * 100
}

// ============ 生命周期 ============
onMounted(() => {
  fetchTrees()
})

// 监听网络变化，重新获取数据
watch(currentNetwork, () => {
  fetchTrees()
})
</script>

<template>
  <div class="trees-page">
    <!-- 系统容量统计（Requirements 9.2） -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">{{ $t('AdminMM.solana.trees.stats.availableTrees') }}</div>
        <div class="stat-value">{{ systemStats.treeCount }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">{{ $t('AdminMM.solana.trees.stats.totalCapacity') }}</div>
        <div class="stat-value">{{ formatCapacity(systemStats.totalCapacity) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">{{ $t('AdminMM.solana.trees.stats.minted') }}</div>
        <div class="stat-value">{{ formatCapacity(systemStats.totalMinted) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">{{ $t('AdminMM.solana.trees.stats.remainingCapacity') }}</div>
        <div class="stat-value" :class="{ 'text-warning': systemStats.needMoreTrees }">
          {{ formatCapacity(systemStats.availableCapacity) }}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">{{ $t('AdminMM.solana.trees.stats.usageRate') }}</div>
        <div class="stat-value">{{ systemStats.usagePercent }}%</div>
        <el-progress 
          :percentage="Number(systemStats.usagePercent)" 
          :show-text="false"
          :stroke-width="4"
          class="stat-progress"
        />
      </div>
    </div>

    <!-- 容量警告（Requirements 9.3） -->
    <div v-if="systemStats.needMoreTrees" class="capacity-warning">
      <el-icon><ExclamationTriangleIcon /></el-icon>
      <span>{{ $t('AdminMM.solana.trees.capacityWarning') }}</span>
      <el-button type="primary" size="small" @click="openCreateDialog">{{ $t('AdminMM.solana.trees.actions.createNow') }}</el-button>
    </div>

    <!-- 操作栏 -->
    <div class="action-bar">
      <el-button type="primary" @click="openCreateDialog">
        <el-icon><PlusIcon /></el-icon>
        {{ $t('AdminMM.solana.trees.actions.createTree') }}
      </el-button>
      <el-button @click="fetchTrees" :loading="treeLoading">
        <el-icon><ArrowPathIcon /></el-icon>
        {{ $t('AdminMM.solana.trees.actions.refresh') }}
      </el-button>
    </div>

    <!-- 树列表（Requirements 9.1） -->
    <div class="tree-list">
      <el-table :data="trees" v-loading="treeLoading" stripe>
        <el-table-column prop="name" :label="$t('AdminMM.solana.trees.table.name')" min-width="140" />
        <el-table-column :label="$t('AdminMM.solana.trees.table.capacityUsage')" width="180">
          <template #default="{ row }">
            <div class="capacity-cell">
              <span>{{ row.mintedCount }} / {{ formatCapacity(Number(row.maxCapacity)) }}</span>
              <el-progress 
                :percentage="getTreeUsage(row)" 
                :show-text="false"
                :stroke-width="4"
                :status="getTreeUsage(row) > 90 ? 'warning' : ''"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="$t('AdminMM.solana.trees.table.config')" width="200">
          <template #default="{ row }">
            <span class="config-text">
              {{ $t('AdminMM.solana.trees.table.configFormat', { depth: row.maxDepth, buffer: row.maxBufferSize, canopy: row.canopyDepth }) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('AdminMM.solana.trees.table.creationCost')" width="120">
          <template #default="{ row }">
            <span>{{ (Number(row.creationCost) / 1e9).toFixed(4) }} SOL</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('AdminMM.solana.trees.table.priority')" width="80">
          <template #default="{ row }">
            <el-tag size="small">{{ row.priority }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('AdminMM.solana.trees.table.status')" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">
              {{ formatStatus(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('AdminMM.solana.trees.table.treeAddress')" min-width="180">
          <template #default="{ row }">
            <span class="address-text" :title="row.treeAddress">
              {{ row.treeAddress.slice(0, 6) }}...{{ row.treeAddress.slice(-6) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('AdminMM.solana.trees.table.operations')" width="180" fixed="right">
          <template #default="{ row }">
            <!-- 验证/删除按钮（Requirements 9.5） -->
            <el-button 
              v-if="row.status === 0 || row.status === -1" 
              type="warning" 
              link 
              size="small" 
              @click="verifyTree(row.id)"
            >
              <el-icon><ArrowPathIcon /></el-icon>
              {{ $t('AdminMM.solana.trees.operations.verify') }}
            </el-button>
            <el-button 
              v-if="row.status === 0 || row.status === -1" 
              type="danger" 
              link 
              size="small" 
              @click="deleteTree(row)"
            >
              {{ $t('AdminMM.solana.trees.operations.delete') }}
            </el-button>
            <el-button type="primary" link size="small" @click="openDetailDialog(row)">
              <el-icon><EyeIcon /></el-icon>
              {{ $t('AdminMM.solana.trees.operations.detail') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 空状态 -->
      <div v-if="!treeLoading && trees.length === 0" class="empty-state">
        <p>{{ $t('AdminMM.solana.trees.empty.title') }}</p>
        <p class="empty-hint">{{ $t('AdminMM.solana.trees.empty.hint') }}</p>
        <el-button type="primary" @click="openCreateDialog">{{ $t('AdminMM.solana.trees.empty.createFirst') }}</el-button>
      </div>
    </div>

    <!-- 创建树弹窗组件（Requirements 7.3） -->
    <CreateTreeDialog
      v-model="showCreateDialog"
      :network="currentNetwork"
      @success="handleCreateSuccess"
    />

    <!-- 树详情弹窗 -->
    <TreeDetailDialog
      v-model="showDetailDialog"
      :tree="currentTree"
    />
  </div>
</template>


<style scoped>
.trees-page {
  --sloth-radius: 4px;
}

/* 统计卡片 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
  margin-bottom: 12px;
}

.stat-card {
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
  padding: 12px;
  backdrop-filter: blur(var(--sloth-blur));
}

.stat-label {
  font-size: 12px;
  color: var(--sloth-text-subtle);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--sloth-text);
}

.stat-value.text-warning {
  color: var(--sloth-danger, #ef4444);
}

.stat-progress {
  margin-top: 8px;
}

/* 容量警告 */
.capacity-warning {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--sloth-radius);
  margin-bottom: 12px;
  color: var(--sloth-danger, #ef4444);
  font-size: 13px;
}

.capacity-warning .el-icon {
  font-size: 18px;
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

/* 树列表卡片 */
.tree-list {
  padding: 12px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
  backdrop-filter: blur(var(--sloth-blur));
}

.capacity-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.config-text {
  font-size: 12px;
  color: var(--sloth-text-subtle);
  font-family: var(--sloth-font-mono, monospace);
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

/* Progress 主题适配 */
:deep(.el-progress-bar__outer) {
  background: var(--sloth-bg-hover);
}

:deep(.el-progress-bar__inner) {
  background-color: var(--sloth-primary);
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

@media (max-width: 960px) {
  .stats-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 640px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
