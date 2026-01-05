<script setup lang="ts">
/**
 * Solana 链上管理页面
 * 
 * 功能：
 * - 系统级 cNFT Merkle Tree 管理
 * - 网络切换（主网/测试网）
 * - 树列表展示和统计
 * - 创建树（通过 CreateTreeDialog 组件）
 * - 验证/删除树
 * 
 * Requirements: 7.3, 9.1, 9.2, 9.3, 9.5
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

definePageMeta({
  layout: 'admin-mm',
})

// ============ 状态管理 ============
const walletStore = useWalletStore()

// 网络配置
const currentNetwork = ref<'mainnet' | 'devnet'>('devnet')
const networkLoading = ref(false)

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
// 获取网络配置
async function fetchNetworkConfig() {
  try {
    const res = await $fetch<{ code: number; data: { network: string } }>('/api/admin/solana/config')
    if (res.code === 0) {
      currentNetwork.value = res.data.network as 'mainnet' | 'devnet'
    }
  } catch (err) {
    console.error('获取网络配置失败', err)
  }
}

// 切换网络（Requirements 11.1, 11.2）
async function switchNetwork(network: 'mainnet' | 'devnet') {
  if (network === 'mainnet') {
    try {
      await ElMessageBox.confirm(
        '切换到主网将使用真实 SOL，请确保您了解相关风险。',
        '切换到主网',
        { confirmButtonText: '确认切换', cancelButtonText: '取消', type: 'warning' }
      )
    } catch {
      return
    }
  }

  networkLoading.value = true
  try {
    const res = await $fetch<{ code: number; message: string }>('/api/admin/solana/config', {
      method: 'PUT',
      body: { network },
    })
    if (res.code === 0) {
      currentNetwork.value = network
      ElMessage.success(res.message)
      fetchTrees()
    }
  } catch (err: any) {
    ElMessage.error(err.message || '切换失败')
  } finally {
    networkLoading.value = false
  }
}

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
    console.error('获取树列表失败', err)
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
    ElMessage.error(err.message || '验证失败')
  }
}

// 删除树记录（Requirements 9.5）
async function deleteTree(tree: any) {
  try {
    await ElMessageBox.confirm(
      `确定要删除树 "${tree.name}" 吗？\n\n此操作只会删除数据库记录，不会影响链上数据。`,
      '确认删除',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
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
    ElMessage.error(err.message || '删除失败')
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
    0: '创建中',
    1: '正常',
    2: '已满',
    [-1]: '失败',
  }
  return map[status] || '未知'
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
onMounted(async () => {
  await fetchNetworkConfig()
  await fetchTrees()
})
</script>

<template>
  <div class="solana-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">链上管理</h1>
        <p class="page-desc">系统级 cNFT Merkle Tree 管理，支持多树冗余</p>
      </div>
      <div class="header-right">
        <!-- 网络切换 -->
        <div class="network-switch">
          <span class="network-label">当前网络:</span>
          <el-radio-group
            v-model="currentNetwork"
            size="small"
            :disabled="networkLoading"
            @change="switchNetwork"
          >
            <el-radio-button value="devnet">
              <span class="network-dot devnet"></span>
              测试网
            </el-radio-button>
            <el-radio-button value="mainnet">
              <span class="network-dot mainnet"></span>
              主网
            </el-radio-button>
          </el-radio-group>
        </div>
      </div>
    </div>

    <!-- 系统容量统计（Requirements 9.2） -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">可用树</div>
        <div class="stat-value">{{ systemStats.treeCount }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">总容量</div>
        <div class="stat-value">{{ formatCapacity(systemStats.totalCapacity) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">已铸造</div>
        <div class="stat-value">{{ formatCapacity(systemStats.totalMinted) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">剩余容量</div>
        <div class="stat-value" :class="{ 'text-warning': systemStats.needMoreTrees }">
          {{ formatCapacity(systemStats.availableCapacity) }}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">使用率</div>
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
      <span>系统容量不足，建议创建新的 Merkle Tree</span>
      <el-button type="primary" size="small" @click="openCreateDialog">立即创建</el-button>
    </div>

    <!-- 操作栏 -->
    <div class="action-bar">
      <el-button type="primary" @click="openCreateDialog">
        <el-icon><PlusIcon /></el-icon>
        创建 Merkle Tree
      </el-button>
      <el-button @click="fetchTrees" :loading="treeLoading">
        <el-icon><ArrowPathIcon /></el-icon>
        刷新
      </el-button>
    </div>

    <!-- 树列表（Requirements 9.1） -->
    <div class="tree-list">
      <el-table :data="trees" v-loading="treeLoading" stripe>
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column label="容量使用" width="180">
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
        <el-table-column label="配置" width="200">
          <template #default="{ row }">
            <span class="config-text">
              深度: {{ row.maxDepth }} | 缓冲: {{ row.maxBufferSize }} | 树冠: {{ row.canopyDepth }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="创建成本" width="120">
          <template #default="{ row }">
            <span>{{ (Number(row.creationCost) / 1e9).toFixed(4) }} SOL</span>
          </template>
        </el-table-column>
        <el-table-column label="优先级" width="80">
          <template #default="{ row }">
            <el-tag size="small">{{ row.priority }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">
              {{ formatStatus(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="树地址" min-width="180">
          <template #default="{ row }">
            <span class="address-text" :title="row.treeAddress">
              {{ row.treeAddress.slice(0, 6) }}...{{ row.treeAddress.slice(-6) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
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
              验证
            </el-button>
            <el-button 
              v-if="row.status === 0 || row.status === -1" 
              type="danger" 
              link 
              size="small" 
              @click="deleteTree(row)"
            >
              删除
            </el-button>
            <el-button type="primary" link size="small" @click="openDetailDialog(row)">
              <el-icon><EyeIcon /></el-icon>
              详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 空状态 -->
      <div v-if="!treeLoading && trees.length === 0" class="empty-state">
        <p>暂无 Merkle Tree，请先创建</p>
        <p class="empty-hint">系统需要至少一个可用的树才能铸造 cNFT</p>
        <el-button type="primary" @click="openCreateDialog">创建第一个树</el-button>
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
.solana-page {
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

.network-switch {
  display: flex;
  align-items: center;
  gap: 12px;
}

.network-label {
  font-size: 13px;
  color: var(--sloth-text-subtle);
  white-space: nowrap;
}

.network-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}

.network-dot.devnet {
  background: #f59e0b;
}

.network-dot.mainnet {
  background: #10b981;
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

:deep(.el-tag--danger) {
  --el-tag-bg-color: rgba(239, 68, 68, 0.1);
  --el-tag-border-color: rgba(239, 68, 68, 0.2);
  --el-tag-text-color: #ef4444;
}

:deep(.el-tag--primary) {
  --el-tag-bg-color: rgba(59, 130, 246, 0.1);
  --el-tag-border-color: rgba(59, 130, 246, 0.2);
  --el-tag-text-color: #3b82f6;
}

/* Radio Button 主题适配 */
:deep(.el-radio-group) {
  --el-radio-button-checked-bg-color: var(--sloth-primary);
  --el-radio-button-checked-border-color: var(--sloth-primary);
  --el-radio-button-checked-text-color: #fff;
}

:deep(.el-radio-button__inner) {
  display: flex;
  align-items: center;
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

@media (max-width: 960px) {
  .stats-grid {
    grid-template-columns: repeat(3, 1fr);
  }
  
  .page-header {
    flex-direction: column;
    gap: 12px;
  }
}

@media (max-width: 640px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
