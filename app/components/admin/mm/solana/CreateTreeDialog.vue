<script setup lang="ts">
/**
 * CreateTreeDialog.vue - Merkle Tree 创建弹窗组件
 * 
 * 功能：
 * - 配置选择界面（预设卡片选择）
 * - 步骤指示器（config → signing → confirming → done）
 * - 钱包签名流程（prepare API → Phantom signTransaction → submit API）
 * - 错误显示和重试
 * 
 * Requirements: 7.1, 7.2, 7.4, 7.5, 1.3, 4.1, 4.2, 4.3, 4.4, 4.5
 * Error Handling: 10.5
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import { 
  CheckCircleIcon, 
  ClockIcon, 
  ExclamationTriangleIcon,
  ArrowPathIcon,
  XCircleIcon,
} from '@heroicons/vue/24/outline'
import { Transaction } from '@solana/web3.js'

// ============ 类型定义 ============
interface TreePreset {
  label: string
  maxDepth: number
  maxBufferSize: number
  canopyDepth: number
  capacity: number
  spaceBytes: number
  rentLamports: number
  rentSol: string
}

interface PrepareResponse {
  transactionBase64: string
  treeAddress: string
  sessionId: string
  rentLamports: number
  spaceBytes: number
  expiresAt: number
}

interface SubmitResponse {
  id: string
  treeAddress: string
  txSignature: string
  status: number
  maxCapacity: string
  priority: number
}

interface TreeRecord {
  id: string
  treeAddress: string
  txSignature: string
  status: number
  maxCapacity: string
  priority: number
}

// 错误类型定义
interface ErrorInfo {
  message: string
  code?: string
  canRetry: boolean
  retryAction?: 'restart' | 'reconnect' | 'recharge'
  details?: string
}

// ============ Props & Emits ============
interface Props {
  modelValue: boolean
  network: 'mainnet' | 'devnet'
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'success': [tree: TreeRecord]
}>()

// ============ 状态管理 ============
const walletStore = useWalletStore()

// 弹窗显示状态
const dialogVisible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

// 创建步骤
type CreateStep = 'config' | 'signing' | 'confirming' | 'done' | 'error'
const step = ref<CreateStep>('config')

// 加载状态
const loading = ref(false)
const estimateLoading = ref(false)
const retrying = ref(false)

// 预设配置
const presets = ref<TreePreset[]>([])
const isEstimate = ref(true)

// 表单数据
const form = ref({
  name: '',
  presetIndex: 1, // 默认选中中型
})

// 错误信息 (Requirement 10.5)
const errorInfo = ref<ErrorInfo | null>(null)

// 会话数据（用于提交）
const sessionData = ref<{
  sessionId: string
  treeAddress: string
} | null>(null)

// ============ 计算属性 ============
// 当前选中的预设
const currentPreset = computed(() => {
  return presets.value[form.value.presetIndex] || null
})

// 树数量（用于默认名称）
const treeCount = ref(0)

// ============ 方法 ============
// 格式化容量
function formatCapacity(capacity: number): string {
  if (capacity >= 1_000_000_000) return `${(capacity / 1_000_000_000).toFixed(1)}B`
  if (capacity >= 1_000_000) return `${(capacity / 1_000_000).toFixed(1)}M`
  if (capacity >= 1_000) return `${(capacity / 1_000).toFixed(1)}K`
  return capacity.toString()
}

/**
 * 解析 API 错误并返回友好的错误信息 (Requirement 10.5)
 */
function parseApiError(err: any): ErrorInfo {
  const message = err?.data?.message || err?.message || '未知错误'
  const code = err?.data?.data?.code || err?.data?.code || ''
  
  // 根据错误码返回友好的错误信息和重试建议
  switch (code) {
    case 'RPC_CONNECTION_FAILED':
    case 'RPC_TIMEOUT':
      return {
        message: '网络连接失败',
        code,
        canRetry: true,
        retryAction: 'restart',
        details: '无法连接到 Solana 网络，请检查网络连接后重试',
      }
    
    case 'INSUFFICIENT_BALANCE':
      const required = err?.data?.data?.required
      const balance = err?.data?.data?.balance
      const shortfall = err?.data?.data?.shortfall
      let balanceDetails = '钱包余额不足，请充值后重试'
      if (shortfall) {
        balanceDetails = `还需要约 ${(shortfall / 1_000_000_000).toFixed(4)} SOL`
      }
      return {
        message: '余额不足',
        code,
        canRetry: true,
        retryAction: 'recharge',
        details: balanceDetails,
      }
    
    case 'SESSION_EXPIRED':
    case 'SESSION_NOT_FOUND':
      return {
        message: '会话已过期',
        code,
        canRetry: true,
        retryAction: 'restart',
        details: '请重新发起创建请求',
      }
    
    case 'TRANSACTION_EXPIRED':
      return {
        message: '交易已过期',
        code,
        canRetry: true,
        retryAction: 'restart',
        details: '交易超时，请重新发起创建请求',
      }
    
    case 'SIGNATURE_INVALID':
      return {
        message: '签名无效',
        code,
        canRetry: true,
        retryAction: 'restart',
        details: '交易签名验证失败，请重新签名',
      }
    
    case 'DUPLICATE_RECORD':
      return {
        message: '重复提交',
        code,
        canRetry: false,
        details: '该树已存在，请勿重复创建',
      }
    
    case 'ENCRYPTION_FAILED':
    case 'DATABASE_ERROR':
      return {
        message: '系统错误',
        code,
        canRetry: true,
        retryAction: 'restart',
        details: '服务器内部错误，请稍后重试',
      }
    
    default:
      // 处理用户取消签名
      if (message.includes('User rejected') || message.includes('用户取消')) {
        return {
          message: '已取消签名',
          canRetry: true,
          retryAction: 'restart',
          details: '您取消了钱包签名，可以重新尝试',
        }
      }
      
      // 处理钱包未安装
      if (message.includes('Phantom')) {
        return {
          message: '钱包未安装',
          canRetry: false,
          details: '请先安装 Phantom 钱包扩展',
        }
      }
      
      return {
        message: message.length > 50 ? message.substring(0, 50) + '...' : message,
        code,
        canRetry: true,
        retryAction: 'restart',
        details: '发生未知错误，请重试',
      }
  }
}

// 获取预估配置
async function fetchEstimates() {
  estimateLoading.value = true
  try {
    const res = await $fetch<{ 
      code: number
      data: { presets: TreePreset[]; isEstimate: boolean } 
    }>('/api/admin/solana/tree/estimate', {
      method: 'POST',
      body: { network: props.network },
    })
    if (res.code === 0) {
      presets.value = res.data.presets
      isEstimate.value = res.data.isEstimate
    }
  } catch (err: any) {
    const errorParsed = parseApiError(err)
    ElMessage.error(errorParsed.message)
  } finally {
    estimateLoading.value = false
  }
}

// 获取树数量（用于默认名称）
async function fetchTreeCount() {
  try {
    const res = await $fetch<{ code: number; data: any[] }>('/api/admin/solana/tree', {
      query: { network: props.network },
    })
    if (res.code === 0) {
      treeCount.value = res.data.length
    }
  } catch {
    treeCount.value = 0
  }
}

// 选择预设
function selectPreset(index: number) {
  form.value.presetIndex = index
}

// 重置状态
function resetState() {
  step.value = 'config'
  errorInfo.value = null
  sessionData.value = null
  loading.value = false
  retrying.value = false
}

// 打开弹窗时初始化
watch(dialogVisible, async (val) => {
  if (val) {
    resetState()
    await Promise.all([fetchEstimates(), fetchTreeCount()])
    // 设置默认名称
    form.value.name = `系统树 #${treeCount.value + 1}`
    // 默认选中中型（索引 1）
    form.value.presetIndex = presets.value.length > 1 ? 1 : 0
  }
})

// 开始创建流程
async function handleCreate() {
  // 1. 验证钱包连接
  if (!walletStore.connected || !walletStore.publicKey) {
    ElMessage.warning('请先连接钱包')
    return
  }

  // 2. 验证表单
  if (!form.value.name.trim()) {
    ElMessage.warning('请输入树名称')
    return
  }

  const preset = currentPreset.value
  if (!preset) {
    ElMessage.warning('请选择配置预设')
    return
  }

  // 3. 确认创建
  try {
    await ElMessageBox.confirm(
      `即将在 ${props.network === 'mainnet' ? '主网' : '测试网'} 创建 Merkle Tree。\n\n` +
      `预估费用：约 ${preset.rentSol} SOL\n` +
      `容量：${formatCapacity(preset.capacity)} cNFTs\n\n` +
      `此操作将从您的钱包扣除 SOL，请确认。`,
      '确认创建 Merkle Tree',
      { confirmButtonText: '确认创建', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }

  // 4. 开始创建流程
  loading.value = true
  errorInfo.value = null

  try {
    // Step 1: 调用 prepare API 获取交易
    step.value = 'signing'
    
    const prepareRes = await $fetch<{ code: number; data: PrepareResponse; message?: string }>(
      '/api/admin/solana/tree/prepare',
      {
        method: 'POST',
        body: {
          name: form.value.name.trim(),
          maxDepth: preset.maxDepth,
          maxBufferSize: preset.maxBufferSize,
          canopyDepth: preset.canopyDepth,
          payerAddress: walletStore.publicKey,
          network: props.network,
        },
      }
    )

    if (prepareRes.code !== 0) {
      throw new Error(prepareRes.message || '准备交易失败')
    }

    const { transactionBase64, treeAddress, sessionId } = prepareRes.data
    sessionData.value = { sessionId, treeAddress }

    // Step 2: 调用 Phantom 钱包签名
    const solana = (window as any).solana
    if (!solana?.isPhantom) {
      throw new Error('请先安装 Phantom 钱包')
    }

    ElMessage.info('请在钱包中确认交易...')

    // 反序列化交易（使用浏览器兼容的 base64 解码）
    const binaryString = atob(transactionBase64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    const transaction = Transaction.from(bytes)

    // 调用钱包签名（Requirements 4.1, 4.2）
    let signedTransaction: Transaction
    try {
      signedTransaction = await solana.signTransaction(transaction)
    } catch (err: any) {
      // 用户拒绝签名（Requirements 4.4）
      if (err.message?.includes('User rejected') || err.code === 4001) {
        throw new Error('用户取消了签名')
      }
      throw err
    }

    // Step 3: 调用 submit API 提交交易
    step.value = 'confirming'
    ElMessage.info('交易已签名，等待链上确认...')

    // 序列化签名后的交易（使用浏览器兼容的 base64 编码）
    const serializedBytes = signedTransaction.serialize()
    const signedTransactionBase64 = btoa(
      String.fromCharCode(...new Uint8Array(serializedBytes))
    )

    const submitRes = await $fetch<{ code: number; data: SubmitResponse; message: string }>(
      '/api/admin/solana/tree/submit',
      {
        method: 'POST',
        body: {
          sessionId,
          signedTransactionBase64,
        },
      }
    )

    if (submitRes.code !== 0) {
      throw new Error(submitRes.message || '提交交易失败')
    }

    // Step 4: 创建成功
    step.value = 'done'
    ElMessage.success('Merkle Tree 创建成功！')

    // 通知父组件
    emit('success', submitRes.data)

    // 延迟关闭弹窗
    setTimeout(() => {
      dialogVisible.value = false
    }, 1500)

  } catch (err: any) {
    console.error('创建失败:', err)
    errorInfo.value = parseApiError(err)
    step.value = 'error'
  } finally {
    loading.value = false
  }
}

// 重试 (Requirement 10.5)
function handleRetry() {
  retrying.value = true
  resetState()
  // 短暂延迟后重新获取预估
  setTimeout(async () => {
    await fetchEstimates()
    retrying.value = false
  }, 300)
}

// 关闭弹窗
function handleClose() {
  if (loading.value && step.value !== 'done') {
    ElMessageBox.confirm(
      '创建流程正在进行中，确定要取消吗？',
      '提示',
      { confirmButtonText: '确定', cancelButtonText: '继续等待', type: 'warning' }
    ).then(() => {
      dialogVisible.value = false
    }).catch(() => {})
  } else {
    dialogVisible.value = false
  }
}

/**
 * 获取重试按钮文本
 */
function getRetryButtonText(): string {
  if (!errorInfo.value) return '重试'
  switch (errorInfo.value.retryAction) {
    case 'recharge':
      return '充值后重试'
    case 'reconnect':
      return '检查网络后重试'
    default:
      return '重试'
  }
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    title="创建 Merkle Tree"
    width="800px"
    :close-on-click-modal="false"
    :before-close="handleClose"
  >
    <!-- 步骤指示器 -->
    <div v-if="step !== 'config'" class="create-steps">
      <div class="step" :class="{ active: step === 'signing', done: ['confirming', 'done'].includes(step) }">
        <div class="step-icon">
          <CheckCircleIcon v-if="['confirming', 'done'].includes(step)" />
          <ClockIcon v-else />
        </div>
        <span>钱包签名</span>
      </div>
      <div class="step-line" :class="{ active: ['confirming', 'done'].includes(step) }"></div>
      <div class="step" :class="{ active: step === 'confirming', done: step === 'done' }">
        <div class="step-icon">
          <CheckCircleIcon v-if="step === 'done'" />
          <ClockIcon v-else />
        </div>
        <span>链上确认</span>
      </div>
      <div class="step-line" :class="{ active: step === 'done' }"></div>
      <div class="step" :class="{ active: step === 'done' }">
        <div class="step-icon">
          <CheckCircleIcon v-if="step === 'done'" />
          <ClockIcon v-else />
        </div>
        <span>完成</span>
      </div>
    </div>

    <!-- 错误提示 (Requirement 10.5) -->
    <div v-if="errorInfo" class="create-error">
      <div class="error-header">
        <XCircleIcon class="error-icon" />
        <span class="error-title">{{ errorInfo.message }}</span>
      </div>
      <p v-if="errorInfo.details" class="error-details">{{ errorInfo.details }}</p>
      <div v-if="errorInfo.code" class="error-code">错误码: {{ errorInfo.code }}</div>
      <el-button 
        v-if="errorInfo.canRetry" 
        type="primary" 
        size="small" 
        :loading="retrying"
        @click="handleRetry"
      >
        {{ getRetryButtonText() }}
      </el-button>
    </div>

    <!-- 配置表单 -->
    <el-form v-if="step === 'config' || step === 'error'" :model="form" label-width="100px">
      <el-form-item label="树名称" required>
        <el-input 
          v-model="form.name" 
          placeholder="输入树名称，便于识别"
          maxlength="128"
          show-word-limit
        />
      </el-form-item>

      <el-form-item label="容量预设">
        <div class="preset-grid" v-loading="estimateLoading">
          <div
            v-for="(preset, index) in presets"
            :key="index"
            class="preset-card"
            :class="{ active: form.presetIndex === index }"
            @click="selectPreset(index)"
          >
            <div class="preset-label">{{ preset.label }}</div>
            <div class="preset-capacity">{{ formatCapacity(preset.capacity) }} cNFTs</div>
            <div class="preset-cost">≈ {{ preset.rentSol }} SOL</div>
          </div>
        </div>
        <div v-if="isEstimate" class="estimate-note">
          <el-icon><ExclamationTriangleIcon /></el-icon>
          费用为估算值，实际以链上为准
        </div>
      </el-form-item>

      <!-- 配置详情 -->
      <div v-if="currentPreset" class="estimate-detail">
        <div class="detail-title">配置详情</div>
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">最大深度</span>
            <span class="detail-value">{{ currentPreset.maxDepth }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">缓冲区大小</span>
            <span class="detail-value">{{ currentPreset.maxBufferSize }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">树冠深度</span>
            <span class="detail-value">{{ currentPreset.canopyDepth }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">账户大小</span>
            <span class="detail-value">{{ (currentPreset.spaceBytes / 1024).toFixed(2) }} KB</span>
          </div>
          <div class="detail-item highlight">
            <span class="detail-label">预估租金</span>
            <span class="detail-value">{{ currentPreset.rentSol }} SOL</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">网络</span>
            <span class="detail-value">{{ network === 'mainnet' ? '主网' : '测试网' }}</span>
          </div>
        </div>
      </div>

      <!-- 说明 -->
      <div class="create-tips">
        <h4>说明</h4>
        <ul>
          <li>Merkle Tree 是系统级资源，所有项目共享使用</li>
          <li>当一个树容量不足时，系统会自动使用下一个可用树</li>
          <li>建议根据预期 cNFT 数量选择合适的容量</li>
          <li>创建后无法修改容量，请谨慎选择</li>
        </ul>
      </div>
    </el-form>

    <!-- 创建中状态 -->
    <div v-else-if="step !== 'error'" class="creating-status">
      <div v-if="step === 'signing'" class="status-content">
        <el-icon class="loading-icon"><ArrowPathIcon /></el-icon>
        <p>请在钱包中确认交易...</p>
        <p class="status-hint">交易需要您的签名授权</p>
      </div>
      <div v-else-if="step === 'confirming'" class="status-content">
        <el-icon class="loading-icon"><ArrowPathIcon /></el-icon>
        <p>等待链上确认...</p>
        <p class="status-hint">通常需要 10-30 秒</p>
      </div>
      <div v-else-if="step === 'done'" class="status-content success">
        <el-icon class="success-icon"><CheckCircleIcon /></el-icon>
        <p>创建成功！</p>
        <p class="status-hint" v-if="sessionData">树地址: {{ sessionData.treeAddress.slice(0, 8) }}...{{ sessionData.treeAddress.slice(-8) }}</p>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <!-- 钱包未连接提示 -->
        <div v-if="!walletStore.connected && (step === 'config' || step === 'error')" class="wallet-hint">
          <ExclamationTriangleIcon class="hint-icon" />
          <span>请先在右上角连接钱包</span>
        </div>
        <div class="footer-actions">
          <el-button @click="handleClose" :disabled="loading && step !== 'done'">
            {{ step === 'done' ? '关闭' : '取消' }}
          </el-button>
          <template v-if="step === 'config' || step === 'error'">
            <el-button
              type="primary"
              :loading="loading"
              :disabled="!form.name.trim() || !walletStore.connected"
              @click="handleCreate"
            >
              {{ walletStore.connected ? '创建 Merkle Tree' : '请先连接钱包' }}
            </el-button>
          </template>
        </div>
      </div>
    </template>
  </el-dialog>
</template>


<style scoped>
/* 步骤指示器 */
.create-steps {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;
  padding: 16px;
  background: var(--sloth-bg);
  border-radius: 10px;
}

.step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--sloth-text-subtle);
  font-size: 0.8rem;
}

.step.active {
  color: var(--sloth-primary);
}

.step.done {
  color: var(--el-color-success);
}

.step-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--sloth-bg-hover);
}

.step.active .step-icon {
  background: var(--sloth-primary-dim);
}

.step.done .step-icon {
  background: rgba(16, 185, 129, 0.1);
}

.step-icon svg {
  width: 18px;
  height: 18px;
}

.step-line {
  width: 60px;
  height: 2px;
  background: var(--sloth-card-border);
  margin: 0 12px;
  margin-bottom: 20px;
}

.step-line.active {
  background: var(--el-color-success);
}

/* 错误提示 (Requirement 10.5) */
.create-error {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 10px;
  margin-bottom: 16px;
}

.error-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.error-icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  color: var(--sloth-danger, #ef4444);
}

.error-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--sloth-danger, #ef4444);
}

.error-details {
  margin: 0;
  font-size: 0.85rem;
  color: var(--sloth-text-subtle);
  line-height: 1.5;
}

.error-code {
  font-size: 0.75rem;
  color: var(--sloth-text-subtle);
  opacity: 0.7;
  font-family: monospace;
}

.create-error .el-button {
  align-self: flex-start;
  margin-top: 4px;
}

/* 预设卡片 */
.preset-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.preset-card {
  padding: 16px;
  border: 2px solid var(--sloth-card-border);
  border-radius: 10px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  background: var(--sloth-bg);
}

.preset-card:hover {
  border-color: var(--sloth-primary);
}

.preset-card.active {
  border-color: var(--sloth-primary);
  background: var(--sloth-primary-dim);
}

.preset-label {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--sloth-text);
  margin-bottom: 4px;
}

.preset-capacity {
  font-size: 0.8rem;
  color: var(--sloth-text-subtle);
  margin-bottom: 8px;
}

.preset-cost {
  font-size: 1rem;
  font-weight: 700;
  color: var(--sloth-primary);
}

.estimate-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 0.8rem;
  color: var(--sloth-text-subtle);
}

/* 配置详情 */
.estimate-detail {
  margin-top: 20px;
  padding: 16px;
  background: var(--sloth-bg);
  border-radius: 10px;
  border: 1px solid var(--sloth-card-border);
}

.detail-title {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--sloth-text);
  margin-bottom: 12px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-item.highlight {
  background: var(--sloth-primary-dim);
  padding: 8px;
  border-radius: 6px;
}

.detail-label {
  font-size: 0.75rem;
  color: var(--sloth-text-subtle);
}

.detail-value {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--sloth-text);
}

.detail-item.highlight .detail-value {
  color: var(--sloth-primary);
}

/* 创建说明 */
.create-tips {
  margin-top: 20px;
  padding: 16px;
  background: var(--sloth-bg);
  border-radius: 10px;
  border: 1px solid var(--sloth-card-border);
}

.create-tips h4 {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--sloth-text);
  margin: 0 0 8px;
}

.create-tips ul {
  margin: 0;
  padding-left: 20px;
}

.create-tips li {
  font-size: 0.85rem;
  color: var(--sloth-text-subtle);
  margin-bottom: 4px;
}

/* 创建中状态 */
.creating-status {
  padding: 48px 24px;
  text-align: center;
}

.status-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.status-content p {
  margin: 0;
  font-size: 1rem;
  color: var(--sloth-text);
}

.status-hint {
  font-size: 0.85rem !important;
  color: var(--sloth-text-subtle) !important;
}

.loading-icon {
  font-size: 48px;
  color: var(--sloth-primary);
  animation: spin 1s linear infinite;
}

.success-icon {
  font-size: 48px;
  color: var(--el-color-success);
}

.status-content.success p:first-of-type {
  color: var(--el-color-success);
  font-weight: 600;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 弹窗底部 */
.dialog-footer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.wallet-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 8px;
  color: #f59e0b;
  font-size: 0.85rem;
}

.hint-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.footer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

/* 响应式 */
@media (max-width: 768px) {
  .preset-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  
  .detail-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* Element Plus 适配 */
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

:deep(.el-button--primary) {
  --el-button-bg-color: var(--sloth-primary);
  --el-button-border-color: var(--sloth-primary);
  --el-button-hover-bg-color: var(--sloth-primary-hover);
  --el-button-hover-border-color: var(--sloth-primary-hover);
}
</style>
