<script setup lang="ts">
import { ElMessage, ElPopover } from 'element-plus'

const walletStore = useWalletStore()

// 是否显示详情弹出框
const showPopover = ref(false)

// 复制地址
async function copyAddress() {
  if (!walletStore.publicKey) return
  try {
    await navigator.clipboard.writeText(walletStore.publicKey)
    ElMessage.success('地址已复制')
  } catch {
    ElMessage.error('复制失败')
  }
}

// 连接钱包
async function handleConnect() {
  try {
    await walletStore.connect()
    ElMessage.success('钱包连接成功')
  } catch (err: any) {
    ElMessage.error(err.message || '连接失败')
  }
}

// 断开连接
async function handleDisconnect() {
  await walletStore.disconnect()
  showPopover.value = false
  ElMessage.info('钱包已断开')
}

// 刷新余额
async function refreshBalance() {
  await walletStore.fetchBalance()
  ElMessage.success('余额已刷新')
}

// 页面加载时检查连接状态
onMounted(() => {
  walletStore.checkConnection()
})
</script>

<template>
  <div class="wallet-connector">
    <!-- 未连接状态 -->
    <button
      v-if="!walletStore.connected"
      class="wallet-btn wallet-btn-connect"
      :disabled="walletStore.connecting"
      @click="handleConnect"
    >
      <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
        <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
      </svg>
      <span v-if="walletStore.connecting" class="btn-text">连接中...</span>
      <span v-else class="btn-text">连接钱包</span>
    </button>

    <!-- 已连接状态 -->
    <el-popover
      v-else
      v-model:visible="showPopover"
      placement="bottom-end"
      :width="280"
      trigger="click"
      popper-class="wallet-popover"
    >
      <template #reference>
        <button class="wallet-btn wallet-btn-connected">
          <span class="status-dot"></span>
          <span class="btn-text">{{ walletStore.shortAddress }}</span>
          <svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
      </template>

      <!-- 弹出框内容 -->
      <div class="wallet-detail">
        <!-- 头部 -->
        <div class="detail-header">
          <div class="wallet-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          </div>
          <div class="wallet-info">
            <div class="wallet-label">Phantom 钱包</div>
            <div class="wallet-status">
              <span class="status-indicator"></span>
              已连接
            </div>
          </div>
        </div>

        <!-- 地址 -->
        <div class="detail-section">
          <div class="section-label">钱包地址</div>
          <div class="address-row">
            <span class="address-text">{{ walletStore.publicKey }}</span>
            <button class="icon-btn" title="复制地址" @click="copyAddress">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- 余额 -->
        <div class="detail-section">
          <div class="section-label">
            SOL 余额
            <button 
              class="icon-btn refresh-btn" 
              :class="{ 'is-loading': walletStore.loadingBalance }"
              title="刷新余额" 
              :disabled="walletStore.loadingBalance"
              @click="refreshBalance"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                <path d="M16 16h5v5"/>
              </svg>
            </button>
          </div>
          <div class="balance-value">
            <span v-if="walletStore.loadingBalance" class="balance-loading">加载中...</span>
            <template v-else>
              <span class="balance-amount">{{ walletStore.solBalance }}</span>
              <span class="balance-unit">SOL</span>
            </template>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="detail-actions">
          <button class="action-btn action-btn-danger" @click="handleDisconnect">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16,17 21,12 16,7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            断开连接
          </button>
        </div>
      </div>
    </el-popover>
  </div>
</template>


<style scoped>
.wallet-connector {
  display: inline-block;
}

/* 基础按钮样式 */
.wallet-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 14px;
  border-radius: 12px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid var(--sloth-card-border);
  backdrop-filter: blur(16px);
}

.wallet-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 连接按钮 - Solana 品牌渐变 */
.wallet-btn-connect {
  background: linear-gradient(135deg, #9945FF 0%, #14F195 100%);
  color: white;
  border: none;
  box-shadow: 0 2px 8px rgba(153, 69, 255, 0.3);
}

.wallet-btn-connect:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(153, 69, 255, 0.4);
}

.wallet-btn-connect:active:not(:disabled) {
  transform: scale(0.98);
}

/* 已连接按钮 */
.wallet-btn-connected {
  background: var(--sloth-card);
  color: var(--sloth-text);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.wallet-btn-connected:hover {
  background: var(--sloth-bg-hover);
  border-color: var(--sloth-primary);
}

/* 图标 */
.btn-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.chevron-icon {
  width: 14px;
  height: 14px;
  opacity: 0.6;
  transition: transform 0.2s;
}

/* 状态点 */
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #14F195;
  box-shadow: 0 0 6px rgba(20, 241, 149, 0.6);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* 弹出框内容 */
.wallet-detail {
  padding: 4px;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--sloth-bg-hover);
  border-radius: 10px;
  margin-bottom: 12px;
}

.wallet-avatar {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, #9945FF 0%, #14F195 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.wallet-avatar svg {
  width: 22px;
  height: 22px;
}

.wallet-info {
  flex: 1;
}

.wallet-label {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--sloth-text);
}

.wallet-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: #14F195;
  margin-top: 2px;
}

.status-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #14F195;
}

/* 详情区块 */
.detail-section {
  padding: 10px 0;
  border-bottom: 1px solid var(--sloth-card-border);
}

.section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--sloth-text-subtle);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.address-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.address-text {
  flex: 1;
  font-size: 0.8rem;
  font-family: var(--sloth-font-mono, monospace);
  color: var(--sloth-text);
  word-break: break-all;
  line-height: 1.4;
}

/* 图标按钮 */
.icon-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: var(--sloth-bg-hover);
  color: var(--sloth-text-subtle);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}

.icon-btn:hover:not(:disabled) {
  background: var(--sloth-primary-dim);
  color: var(--sloth-primary);
}

.icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon-btn svg {
  width: 14px;
  height: 14px;
}

.refresh-btn svg {
  width: 12px;
  height: 12px;
}

.refresh-btn.is-loading svg {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 余额 */
.balance-value {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.balance-amount {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--sloth-text);
  font-family: var(--sloth-font-mono, monospace);
}

.balance-unit {
  font-size: 0.85rem;
  color: var(--sloth-text-subtle);
  font-weight: 500;
}

.balance-loading {
  font-size: 0.9rem;
  color: var(--sloth-text-subtle);
}

/* 操作按钮 */
.detail-actions {
  padding-top: 12px;
}

.action-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.action-btn svg {
  width: 16px;
  height: 16px;
}

.action-btn-danger {
  background: rgba(239, 68, 68, 0.1);
  color: var(--sloth-danger, #ef4444);
}

.action-btn-danger:hover {
  background: rgba(239, 68, 68, 0.2);
}
</style>

<style>
/* 全局样式覆盖 popover - 支持明暗主题 */
.wallet-popover {
  border-radius: 14px !important;
  border: 1px solid var(--sloth-card-border) !important;
  box-shadow: var(--sloth-shadow-hover) !important;
  background: var(--sloth-card) !important;
}

.wallet-popover .el-popover__title {
  display: none;
}

/* 暗黑模式下的 popover */
.dark .wallet-popover {
  background: var(--sloth-card) !important;
  border-color: var(--sloth-card-border) !important;
}
</style>
