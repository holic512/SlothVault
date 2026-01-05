<script setup lang="ts">
/**
 * Merkle Tree 详情弹窗
 * 展示树的完整信息，包括链上数据和配置
 */
import { DocumentDuplicateIcon, ArrowTopRightOnSquareIcon } from '@heroicons/vue/24/outline'
import { ElMessage } from 'element-plus'

interface TreeData {
  id: string
  name: string
  treeAddress: string
  collectionMint: string | null
  maxDepth: number
  maxBufferSize: number
  canopyDepth: number
  maxCapacity: string | number
  mintedCount: number
  status: number
  priority: number
  network: string
  creationCost: string | number
  creatorAddress: string | null
  txSignature: string | null
  createdAt: string
  updatedAt: string
}

const props = defineProps<{
  modelValue: boolean
  tree: TreeData | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

// 格式化容量
function formatCapacity(capacity: number | string): string {
  const num = Number(capacity)
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toString()
}

// 格式化状态
function formatStatus(status: number): { text: string; type: string } {
  const map: Record<number, { text: string; type: string }> = {
    0: { text: '创建中', type: 'warning' },
    1: { text: '正常', type: 'success' },
    2: { text: '已满', type: 'info' },
    [-1]: { text: '失败', type: 'danger' },
  }
  return map[status] || { text: '未知', type: 'info' }
}

// 格式化时间
function formatTime(dateStr: string): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// 计算使用率
const usagePercent = computed(() => {
  if (!props.tree) return 0
  const capacity = Number(props.tree.maxCapacity)
  if (capacity === 0) return 0
  return ((props.tree.mintedCount / capacity) * 100).toFixed(1)
})

// 复制到剪贴板
async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(`${label}已复制`)
  } catch {
    ElMessage.error('复制失败')
  }
}

// 在浏览器中打开
function openInExplorer(address: string, type: 'address' | 'tx' = 'address') {
  if (!props.tree) return
  const network = props.tree.network === 'mainnet' ? '' : '?cluster=devnet'
  const path = type === 'tx' ? 'tx' : 'address'
  window.open(`https://explorer.solana.com/${path}/${address}${network}`, '_blank')
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    title="Merkle Tree 详情"
    width="800px"
    :close-on-click-modal="false"
  >
    <div v-if="tree" class="detail-content">
      <!-- 基本信息 -->
      <div class="detail-section">
        <h3 class="section-title">基本信息</h3>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">名称</span>
            <span class="info-value">{{ tree.name }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">状态</span>
            <el-tag :type="formatStatus(tree.status).type" size="small">
              {{ formatStatus(tree.status).text }}
            </el-tag>
          </div>
          <div class="info-item">
            <span class="info-label">优先级</span>
            <el-tag size="small">{{ tree.priority }}</el-tag>
          </div>
          <div class="info-item">
            <span class="info-label">网络</span>
            <el-tag :type="tree.network === 'mainnet' ? 'success' : 'warning'" size="small">
              {{ tree.network === 'mainnet' ? '主网' : '测试网' }}
            </el-tag>
          </div>
        </div>
      </div>

      <!-- 容量信息 -->
      <div class="detail-section">
        <h3 class="section-title">容量信息</h3>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">最大容量</span>
            <span class="info-value">{{ formatCapacity(tree.maxCapacity) }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">已铸造</span>
            <span class="info-value">{{ tree.mintedCount }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">剩余容量</span>
            <span class="info-value">{{ formatCapacity(Number(tree.maxCapacity) - tree.mintedCount) }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">使用率</span>
            <span class="info-value">{{ usagePercent }}%</span>
          </div>
        </div>
        <el-progress 
          :percentage="Number(usagePercent)" 
          :stroke-width="8"
          :status="Number(usagePercent) > 90 ? 'warning' : ''"
          class="usage-progress"
        />
      </div>

      <!-- 树配置 -->
      <div class="detail-section">
        <h3 class="section-title">树配置</h3>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">最大深度</span>
            <span class="info-value mono">{{ tree.maxDepth }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">缓冲区大小</span>
            <span class="info-value mono">{{ tree.maxBufferSize }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">树冠深度</span>
            <span class="info-value mono">{{ tree.canopyDepth }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">创建成本</span>
            <span class="info-value">{{ (Number(tree.creationCost) / 1e9).toFixed(4) }} SOL</span>
          </div>
        </div>
      </div>

      <!-- 链上地址 -->
      <div class="detail-section">
        <h3 class="section-title">链上地址</h3>
        <div class="address-list">
          <div class="address-item">
            <span class="address-label">树地址</span>
            <div class="address-value-wrap">
              <span class="address-value mono">{{ tree.treeAddress }}</span>
              <div class="address-actions">
                <el-button link size="small" @click="copyToClipboard(tree.treeAddress, '树地址')">
                  <el-icon><DocumentDuplicateIcon /></el-icon>
                </el-button>
                <el-button link size="small" @click="openInExplorer(tree.treeAddress)">
                  <el-icon><ArrowTopRightOnSquareIcon /></el-icon>
                </el-button>
              </div>
            </div>
          </div>
          <div v-if="tree.collectionMint" class="address-item">
            <span class="address-label">Collection Mint</span>
            <div class="address-value-wrap">
              <span class="address-value mono">{{ tree.collectionMint }}</span>
              <div class="address-actions">
                <el-button link size="small" @click="copyToClipboard(tree.collectionMint!, 'Collection Mint')">
                  <el-icon><DocumentDuplicateIcon /></el-icon>
                </el-button>
                <el-button link size="small" @click="openInExplorer(tree.collectionMint!)">
                  <el-icon><ArrowTopRightOnSquareIcon /></el-icon>
                </el-button>
              </div>
            </div>
          </div>
          <div v-if="tree.creatorAddress" class="address-item">
            <span class="address-label">创建者地址</span>
            <div class="address-value-wrap">
              <span class="address-value mono">{{ tree.creatorAddress }}</span>
              <div class="address-actions">
                <el-button link size="small" @click="copyToClipboard(tree.creatorAddress!, '创建者地址')">
                  <el-icon><DocumentDuplicateIcon /></el-icon>
                </el-button>
                <el-button link size="small" @click="openInExplorer(tree.creatorAddress!)">
                  <el-icon><ArrowTopRightOnSquareIcon /></el-icon>
                </el-button>
              </div>
            </div>
          </div>
          <div v-if="tree.txSignature" class="address-item">
            <span class="address-label">创建交易</span>
            <div class="address-value-wrap">
              <span class="address-value mono">{{ tree.txSignature }}</span>
              <div class="address-actions">
                <el-button link size="small" @click="copyToClipboard(tree.txSignature!, '交易签名')">
                  <el-icon><DocumentDuplicateIcon /></el-icon>
                </el-button>
                <el-button link size="small" @click="openInExplorer(tree.txSignature!, 'tx')">
                  <el-icon><ArrowTopRightOnSquareIcon /></el-icon>
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 时间信息 -->
      <div class="detail-section">
        <h3 class="section-title">时间信息</h3>
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">创建时间</span>
            <span class="info-value">{{ formatTime(tree.createdAt) }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">更新时间</span>
            <span class="info-value">{{ formatTime(tree.updatedAt) }}</span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="dialogVisible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.detail-content {
  max-height: 60vh;
  overflow-y: auto;
}

.detail-section {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--sloth-card-border);
}

.detail-section:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--sloth-text);
  margin: 0 0 12px;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-label {
  font-size: 12px;
  color: var(--sloth-text-subtle);
}

.info-value {
  font-size: 14px;
  color: var(--sloth-text);
  font-weight: 500;
}

.info-value.mono {
  font-family: var(--sloth-font-mono, monospace);
}

.usage-progress {
  margin-top: 12px;
}

.address-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.address-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.address-label {
  font-size: 12px;
  color: var(--sloth-text-subtle);
}

.address-value-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--sloth-bg-hover);
  padding: 8px 12px;
  border-radius: 4px;
}

.address-value {
  flex: 1;
  font-size: 12px;
  color: var(--sloth-text);
  word-break: break-all;
}

.address-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

/* Element Plus 主题适配 */
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

:deep(.el-button) {
  padding: 6px 12px;
  font-size: 13px;
  height: 30px;
}

:deep(.el-button--default) {
  --el-button-bg-color: var(--sloth-bg);
  --el-button-text-color: var(--sloth-text);
  --el-button-border-color: var(--sloth-card-border);
  --el-button-hover-bg-color: var(--sloth-bg-hover);
  --el-button-hover-text-color: var(--sloth-primary);
  --el-button-hover-border-color: var(--sloth-primary);
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

:deep(.el-tag--danger) {
  --el-tag-bg-color: rgba(239, 68, 68, 0.1);
  --el-tag-border-color: rgba(239, 68, 68, 0.2);
  --el-tag-text-color: #ef4444;
}

:deep(.el-progress-bar__outer) {
  background: var(--sloth-bg-hover);
}

:deep(.el-progress-bar__inner) {
  background-color: var(--sloth-primary);
}

@media (max-width: 640px) {
  .info-grid {
    grid-template-columns: 1fr;
  }
}
</style>
