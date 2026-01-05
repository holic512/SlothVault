<script setup lang="ts">
/**
 * MintCnftDialog.vue - cNFT 铸造弹窗组件
 *
 * 功能：
 * - 项目选择下拉框（获取项目列表）
 * - 接收者地址输入框（带 Solana 地址格式验证）
 * - NFT 名称输入框（默认值：项目名称 + " Access Pass"）
 * - 可选的符号和元数据 URI 输入
 * - 步骤指示器（prepare → signing → confirming → done）
 * - 钱包未连接时的禁用状态和提示
 * - 错误显示和重试按钮
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 4.1, 4.2, 4.3, 4.4, 4.5, 7.1, 7.2, 7.3, 7.4, 7.5
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
import bs58 from 'bs58'

// ============ 类型定义 ============
interface ProjectItem {
  id: string
  projectName: string
  avatar: string | null
  status: number
}

interface PrepareResponse {
  transactionBase64: string
  sessionId: string
  merkleTree: {
    id: string
    address: string
    name: string
  }
  leafIndex: number
  cnftId: string
  expiresAt: number
}

interface SubmitResponse {
  cnftId: string
  assetId: string
  txSignature: string
  status: number
  leafIndex: number
}

interface CnftRecord {
  id: string
  assetId: string
  txSignature: string
  status: number
  leafIndex: number
  name: string
  ownerAddress: string
  projectId: string
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
  'success': [cnft: CnftRecord]
}>()

// ============ 状态管理 ============
const walletStore = useWalletStore()

// 弹窗显示状态
const dialogVisible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
})

// 铸造步骤 (Requirement 7.1)
type MintStep = 'form' | 'signing' | 'confirming' | 'done' | 'error'
const step = ref<MintStep>('form')

// 加载状态
const loading = ref(false)
const projectLoading = ref(false)
const retrying = ref(false)

// 项目列表 (Requirement 1.2)
const projects = ref<ProjectItem[]>([])

// 表单数据 (Requirements 1.1-1.6)
const form = ref({
  projectId: '',
  ownerAddress: '',
  name: '',
  symbol: '',
  metadataUri: '',
})

// 表单验证错误 (Requirement 1.8)
const formErrors = ref({
  projectId: '',
  ownerAddress: '',
  name: '',
})

// 错误信息 (Requirement 7.5)
const errorInfo = ref<ErrorInfo | null>(null)

// 会话数据（用于提交）
const sessionData = ref<{
  sessionId: string
  merkleTree: { id: string; address: string; name: string }
  cnftId: string
  leafIndex: number
} | null>(null)

// 铸造结果
const mintResult = ref<SubmitResponse | null>(null)

// ============ 计算属性 ============
// 当前选中的项目
const currentProject = computed(() => {
  return projects.value.find(p => p.id === form.value.projectId) || null
})

// 表单是否有效
const isFormValid = computed(() => {
  return (
    form.value.projectId &&
    form.value.ownerAddress &&
    form.value.name.trim() &&
    !formErrors.value.projectId &&
    !formErrors.value.ownerAddress &&
    !formErrors.value.name
  )
})

// ============ 方法 ============
/**
 * 验证 Solana 地址格式 (Requirement 1.3)
 */
function isValidSolanaAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false
  try {
    const decoded = bs58.decode(address)
    return decoded.length === 32
  } catch {
    return false
  }
}

/**
 * 验证接收者地址 (Requirement 1.3)
 */
function validateOwnerAddress() {
  const address = form.value.ownerAddress.trim()
  if (!address) {
    formErrors.value.ownerAddress = '请输入接收者地址'
    return false
  }
  if (!isValidSolanaAddress(address)) {
    formErrors.value.ownerAddress = '无效的 Solana 地址格式'
    return false
  }
  formErrors.value.ownerAddress = ''
  return true
}

/**
 * 验证 NFT 名称（检查 UTF-8 字节长度，最大 32 字节）
 */
function validateName() {
  const name = form.value.name.trim()
  if (!name) {
    formErrors.value.name = '请输入 NFT 名称'
    return false
  }
  // 检查 UTF-8 字节长度（Bubblegum 限制 32 字节）
  const byteLength = new TextEncoder().encode(name).length
  if (byteLength > 32) {
    formErrors.value.name = `名称过长（${byteLength}/32 字节），请使用更短的英文名称`
    return false
  }
  formErrors.value.name = ''
  return true
}

/**
 * 解析 API 错误并返回友好的错误信息
 */
function parseApiError(err: any): ErrorInfo {
  const message = err?.data?.message || err?.message || '未知错误'
  const code = err?.data?.data?.code || err?.data?.code || ''

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
      return {
        message: '余额不足',
        code,
        canRetry: true,
        retryAction: 'recharge',
        details: '钱包余额不足，请充值后重试',
      }

    case 'SESSION_EXPIRED':
    case 'SESSION_NOT_FOUND':
    case 'MINT_SESSION_EXPIRED':
      return {
        message: '会话已过期',
        code,
        canRetry: true,
        retryAction: 'restart',
        details: '请重新发起铸造请求',
      }

    case 'TRANSACTION_EXPIRED':
      return {
        message: '交易已过期',
        code,
        canRetry: true,
        retryAction: 'restart',
        details: '交易超时，请重新发起铸造请求',
      }

    case 'NO_AVAILABLE_TREE':
      return {
        message: '没有可用的 Merkle Tree',
        code,
        canRetry: false,
        details: '请先创建 Merkle Tree',
      }

    case 'TREE_CAPACITY_FULL':
      return {
        message: '树容量已满',
        code,
        canRetry: false,
        details: '当前树容量已满，请创建新树',
      }

    case 'INVALID_ADDRESS':
      return {
        message: '无效的地址格式',
        code,
        canRetry: true,
        retryAction: 'restart',
        details: '请检查接收者地址是否正确',
      }

    case 'PROJECT_NOT_FOUND':
      return {
        message: '项目不存在',
        code,
        canRetry: true,
        retryAction: 'restart',
        details: '请选择有效的项目',
      }

    default:
      // 处理用户取消签名 (Requirement 4.3)
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

/**
 * 获取项目列表 (Requirement 1.2)
 */
async function fetchProjects() {
  projectLoading.value = true
  try {
    const res = await $fetch<{
      code: number
      data: { list: ProjectItem[]; total: number }
    }>('/api/admin/mm/project', {
      query: { pageSize: 100, status: 1 }, // 只获取启用的项目
    })
    if (res.code === 0) {
      projects.value = res.data.list
    }
  } catch (err: any) {
    console.error('获取项目列表失败:', err)
    ElMessage.error('获取项目列表失败')
  } finally {
    projectLoading.value = false
  }
}

/**
 * 项目选择变化时更新默认名称 (Requirement 1.4)
 * 使用简短的英文格式避免超过 32 字节限制
 */
function handleProjectChange(projectId: string) {
  const project = projects.value.find(p => p.id === projectId)
  if (project) {
    // 使用简短格式：项目ID + Pass，确保不超过 32 字节
    form.value.name = `Project #${projectId} Pass`
  }
  formErrors.value.projectId = ''
}

/**
 * 重置状态
 */
function resetState() {
  step.value = 'form'
  errorInfo.value = null
  sessionData.value = null
  mintResult.value = null
  loading.value = false
  retrying.value = false
  formErrors.value = { projectId: '', ownerAddress: '', name: '' }
}

/**
 * 重置表单
 */
function resetForm() {
  form.value = {
    projectId: '',
    ownerAddress: '',
    name: '',
    symbol: '',
    metadataUri: '',
  }
}

// 打开弹窗时初始化 (Requirement 1.1)
watch(dialogVisible, async (val) => {
  if (val) {
    resetState()
    resetForm()
    await fetchProjects()
  }
})

/**
 * 开始铸造流程 (Requirements 4.1-4.5)
 */
async function handleMint() {
  // 1. 验证钱包连接 (Requirement 1.7)
  if (!walletStore.connected || !walletStore.publicKey) {
    ElMessage.warning('请先连接钱包')
    return
  }

  // 2. 验证表单
  if (!form.value.projectId) {
    formErrors.value.projectId = '请选择项目'
    return
  }
  if (!validateOwnerAddress()) return
  if (!validateName()) return

  // 3. 确认铸造
  try {
    await ElMessageBox.confirm(
      `即将在 ${props.network === 'mainnet' ? '主网' : '测试网'} 铸造 cNFT。\n\n` +
        `项目：${currentProject.value?.projectName}\n` +
        `接收者：${form.value.ownerAddress.slice(0, 8)}...${form.value.ownerAddress.slice(-8)}\n` +
        `名称：${form.value.name}\n\n` +
        `此操作将从您的钱包扣除少量 SOL 作为交易费，请确认。`,
      '确认铸造 cNFT',
      { confirmButtonText: '确认铸造', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }

  // 4. 开始铸造流程
  loading.value = true
  errorInfo.value = null

  try {
    // Step 1: 调用 prepare API 获取交易 (Requirement 4.1)
    step.value = 'signing'

    const prepareRes = await $fetch<{
      code: number
      data: PrepareResponse
      message?: string
    }>('/api/admin/solana/cnft/prepare', {
      method: 'POST',
      body: {
        projectId: form.value.projectId,
        ownerAddress: form.value.ownerAddress.trim(),
        name: form.value.name.trim(),
        symbol: form.value.symbol.trim() || undefined,
        metadataUri: form.value.metadataUri.trim() || undefined,
        payerAddress: walletStore.publicKey,
        network: props.network,
      },
    })

    if (prepareRes.code !== 0) {
      throw new Error(prepareRes.message || '准备交易失败')
    }

    const { transactionBase64, sessionId, merkleTree, leafIndex, cnftId } = prepareRes.data
    sessionData.value = { sessionId, merkleTree, cnftId, leafIndex }

    // Step 2: 调用 Phantom 钱包签名 (Requirement 4.2)
    const solana = (window as any).solana
    if (!solana?.isPhantom) {
      throw new Error('请先安装 Phantom 钱包')
    }

    ElMessage.info('请在钱包中确认交易...')

    // 反序列化交易
    const binaryString = atob(transactionBase64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    const transaction = Transaction.from(bytes)

    // 调用钱包签名
    let signedTransaction: Transaction
    try {
      signedTransaction = await solana.signTransaction(transaction)
    } catch (err: any) {
      // 用户拒绝签名 (Requirement 4.3)
      if (err.message?.includes('User rejected') || err.code === 4001) {
        throw new Error('用户取消了签名')
      }
      throw err
    }

    // Step 3: 调用 submit API 提交交易 (Requirement 4.5)
    step.value = 'confirming'
    ElMessage.info('交易已签名，等待链上确认...')

    // 序列化签名后的交易
    const serializedBytes = signedTransaction.serialize()
    const signedTransactionBase64 = btoa(String.fromCharCode(...new Uint8Array(serializedBytes)))

    const submitRes = await $fetch<{
      code: number
      data: SubmitResponse
      message: string
    }>('/api/admin/solana/cnft/submit', {
      method: 'POST',
      body: {
        sessionId,
        signedTransactionBase64,
      },
    })

    if (submitRes.code !== 0 && submitRes.code !== 1) {
      throw new Error(submitRes.message || '提交交易失败')
    }

    // Step 4: 铸造成功 (Requirement 7.4)
    mintResult.value = submitRes.data
    step.value = 'done'
    ElMessage.success(submitRes.code === 0 ? '铸造成功！' : '交易已提交，等待确认中')

    // 通知父组件
    emit('success', {
      id: submitRes.data.cnftId,
      assetId: submitRes.data.assetId,
      txSignature: submitRes.data.txSignature,
      status: submitRes.data.status,
      leafIndex: submitRes.data.leafIndex,
      name: form.value.name,
      ownerAddress: form.value.ownerAddress,
      projectId: form.value.projectId,
    })

    // 延迟关闭弹窗
    setTimeout(() => {
      dialogVisible.value = false
    }, 2000)
  } catch (err: any) {
    console.error('铸造失败:', err)
    errorInfo.value = parseApiError(err)
    step.value = 'error'
  } finally {
    loading.value = false
  }
}

/**
 * 重试 (Requirement 7.5)
 */
function handleRetry() {
  retrying.value = true
  resetState()
  setTimeout(() => {
    retrying.value = false
  }, 300)
}

/**
 * 关闭弹窗
 */
function handleClose() {
  if (loading.value && step.value !== 'done') {
    ElMessageBox.confirm('铸造流程正在进行中，确定要取消吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '继续等待',
      type: 'warning',
    })
      .then(() => {
        dialogVisible.value = false
      })
      .catch(() => {})
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
    title="铸造 cNFT"
    width="600px"
    :close-on-click-modal="false"
    :before-close="handleClose"
  >
    <!-- 步骤指示器 (Requirement 7.1) -->
    <div v-if="step !== 'form'" class="mint-steps">
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

    <!-- 错误提示 (Requirement 7.5) -->
    <div v-if="errorInfo" class="mint-error">
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

    <!-- 铸造表单 (Requirements 1.1-1.6) -->
    <el-form v-if="step === 'form' || step === 'error'" :model="form" label-width="100px">
      <!-- 项目选择 (Requirement 1.2) -->
      <el-form-item label="项目" required :error="formErrors.projectId">
        <el-select
          v-model="form.projectId"
          placeholder="请选择项目"
          filterable
          :loading="projectLoading"
          style="width: 100%"
          @change="handleProjectChange"
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
      </el-form-item>

      <!-- 接收者地址 (Requirement 1.3) -->
      <el-form-item label="接收者地址" required :error="formErrors.ownerAddress">
        <el-input
          v-model="form.ownerAddress"
          placeholder="输入 Solana 钱包地址"
          @blur="validateOwnerAddress"
        />
      </el-form-item>

      <!-- NFT 名称 (Requirement 1.4) -->
      <el-form-item label="NFT 名称" required :error="formErrors.name">
        <el-input
          v-model="form.name"
          placeholder="输入 NFT 名称"
          maxlength="32"
          show-word-limit
          @blur="validateName"
        />
      </el-form-item>

      <!-- NFT 符号 (Requirement 1.5) -->
      <el-form-item label="符号">
        <el-input
          v-model="form.symbol"
          placeholder="可选，如 PASS"
          maxlength="10"
          show-word-limit
        />
      </el-form-item>

      <!-- 元数据 URI (Requirement 1.6) -->
      <el-form-item label="元数据 URI">
        <el-input v-model="form.metadataUri" placeholder="可选，NFT 元数据 JSON 的 URL" />
      </el-form-item>

      <!-- 说明 -->
      <div class="mint-tips">
        <h4>说明</h4>
        <ul>
          <li>cNFT 将铸造到系统自动选择的 Merkle Tree 中</li>
          <li>铸造费用约 0.00001 SOL，从您的钱包扣除</li>
          <li>铸造成功后，接收者可在钱包中查看 NFT</li>
          <li>当前网络：{{ network === 'mainnet' ? '主网' : '测试网' }}</li>
        </ul>
      </div>
    </el-form>

    <!-- 铸造中状态 (Requirements 7.2, 7.3) -->
    <div v-else-if="step !== 'error'" class="minting-status">
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
        <p>铸造成功！</p>
        <div v-if="mintResult" class="result-info">
          <p class="status-hint">Asset ID: {{ mintResult.assetId.slice(0, 8) }}...{{ mintResult.assetId.slice(-8) }}</p>
          <p class="status-hint">Leaf Index: {{ mintResult.leafIndex }}</p>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <!-- 钱包未连接提示 (Requirement 1.7) -->
        <div v-if="!walletStore.connected && (step === 'form' || step === 'error')" class="wallet-hint">
          <ExclamationTriangleIcon class="hint-icon" />
          <span>请先在右上角连接钱包</span>
        </div>
        <div class="footer-actions">
          <el-button @click="handleClose" :disabled="loading && step !== 'done'">
            {{ step === 'done' ? '关闭' : '取消' }}
          </el-button>
          <template v-if="step === 'form' || step === 'error'">
            <el-button
              type="primary"
              :loading="loading"
              :disabled="!isFormValid || !walletStore.connected"
              @click="handleMint"
            >
              {{ walletStore.connected ? '铸造 cNFT' : '请先连接钱包' }}
            </el-button>
          </template>
        </div>
      </div>
    </template>
  </el-dialog>
</template>


<style scoped>
/* 步骤指示器 */
.mint-steps {
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

/* 错误提示 */
.mint-error {
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

.mint-error .el-button {
  align-self: flex-start;
  margin-top: 4px;
}

/* 项目选项 */
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

/* 铸造说明 */
.mint-tips {
  margin-top: 20px;
  padding: 16px;
  background: var(--sloth-bg);
  border-radius: 10px;
  border: 1px solid var(--sloth-card-border);
}

.mint-tips h4 {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--sloth-text);
  margin: 0 0 8px;
}

.mint-tips ul {
  margin: 0;
  padding-left: 20px;
}

.mint-tips li {
  font-size: 0.85rem;
  color: var(--sloth-text-subtle);
  margin-bottom: 4px;
}

/* 铸造中状态 */
.minting-status {
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

.result-info {
  margin-top: 8px;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
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

:deep(.el-select) {
  width: 100%;
}

:deep(.el-select .el-input__wrapper) {
  padding: 0 8px;
  background-color: var(--sloth-bg);
  box-shadow: 0 0 0 1px var(--sloth-card-border) inset;
}

:deep(.el-select .el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--sloth-primary) inset;
}

:deep(.el-select .el-input.is-focus .el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--sloth-primary) inset;
}

:deep(.el-button--primary) {
  --el-button-bg-color: var(--sloth-primary);
  --el-button-border-color: var(--sloth-primary);
  --el-button-hover-bg-color: var(--sloth-primary-hover);
  --el-button-hover-border-color: var(--sloth-primary-hover);
}
</style>
