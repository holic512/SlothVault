<script setup lang="ts">
import { ElMessage, ElPopover } from 'element-plus'

const walletStore = useWalletStore()

// 是否显示详情弹出框
const showPopover = ref(false)

// 复制成功状态
const copied = ref(false)

// 复制地址
async function copyAddress() {
  if (!walletStore.publicKey) return
  try {
    await navigator.clipboard.writeText(walletStore.publicKey)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
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
      class="connect-btn"
      :class="{ 'is-connecting': walletStore.connecting }"
      :disabled="walletStore.connecting"
      @click="handleConnect"
    >
      <!-- 动态背景 -->
      <span class="btn-bg"></span>
      <span class="btn-glow"></span>

      <!-- 内容 -->
      <span class="btn-content">
        <svg v-if="!walletStore.connecting" class="btn-icon" viewBox="0 0 24 24" fill="none">
          <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span v-else class="loading-spinner"></span>
        <span class="btn-text">{{ walletStore.connecting ? '连接中' : '连接钱包' }}</span>
      </span>
    </button>

    <!-- 已连接状态 -->
    <el-popover
      v-else
      v-model:visible="showPopover"
      placement="bottom-end"
      :width="320"
      trigger="click"
      popper-class="wallet-popover-web3"
      :show-arrow="false"
    >
      <template #reference>
        <button class="connected-btn" :class="{ 'is-open': showPopover }">
          <!-- 状态指示器 -->
          <span class="live-indicator">
            <span class="live-dot"></span>
            <span class="live-ring"></span>
          </span>

          <!-- 地址显示 -->
          <span class="address-display">
            <span class="address-text">{{ walletStore.shortAddress }}</span>
          </span>

          <!-- 下拉箭头 -->
          <svg class="chevron" viewBox="0 0 24 24" fill="none">
            <path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </template>

      <!-- 弹出框内容 -->
      <div class="wallet-panel">
        <!-- 头部卡片 -->
        <div class="panel-header">
          <div class="header-bg"></div>
          <div class="header-content">
            <!-- Phantom Logo -->
            <div class="wallet-logo">
              <svg viewBox="0 0 128 128" fill="none">
                <circle cx="64" cy="64" r="64" fill="url(#phantom-gradient)"/>
                <path d="M110.584 64.9142H99.142C99.142 41.7651 80.173 23 56.7724 23C33.6612 23 14.8716 41.3057 14.4118 64.0583C13.936 87.5709 33.5765 107.381 57.1344 107.381H60.5765C81.1792 107.381 99.5765 93.4091 105.428 73.6987C106.949 68.7277 103.507 64.9142 99.142 64.9142H110.584Z" fill="white"/>
                <ellipse cx="44.5" cy="64.5" rx="7.5" ry="8.5" fill="url(#phantom-gradient)"/>
                <ellipse cx="69.5" cy="64.5" rx="7.5" ry="8.5" fill="url(#phantom-gradient)"/>
                <defs>
                  <linearGradient id="phantom-gradient" x1="0" y1="0" x2="128" y2="128">
                    <stop stop-color="#534BB1"/>
                    <stop offset="1" stop-color="#551BF9"/>
                  </linearGradient>
                </defs>
              </svg>
            </div>

            <div class="wallet-meta">
              <span class="wallet-name">Phantom</span>
              <span class="connection-status">
                <span class="status-dot"></span>
                已连接到 Solana
              </span>
            </div>
          </div>
        </div>

        <!-- 地址区块 -->
        <div class="address-section">
          <div class="section-header">
            <span class="section-title">钱包地址</span>
            <button
              class="copy-btn"
              :class="{ 'is-copied': copied }"
              @click="copyAddress"
            >
              <svg v-if="!copied" viewBox="0 0 24 24" fill="none">
                <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.5"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>{{ copied ? '已复制' : '复制' }}</span>
            </button>
          </div>
          <div class="address-full">
            <span>{{ walletStore.publicKey }}</span>
          </div>
        </div>

        <!-- 余额区块 -->
        <div class="balance-section">
          <div class="balance-card">
            <div class="balance-header">
              <div class="token-info">
                <div class="token-icon">
                  <svg viewBox="0 0 128 128" fill="none">
                    <circle cx="64" cy="64" r="64" fill="url(#sol-gradient)"/>
                    <path d="M40.5 80.5L53.5 67.5H94.5L81.5 80.5H40.5Z" fill="white"/>
                    <path d="M40.5 47.5L53.5 60.5H94.5L81.5 47.5H40.5Z" fill="white"/>
                    <path d="M40.5 34.5L53.5 47.5H94.5L81.5 34.5H40.5Z" fill="white"/>
                    <defs>
                      <linearGradient id="sol-gradient" x1="0" y1="0" x2="128" y2="128">
                        <stop stop-color="#00FFA3"/>
                        <stop offset="1" stop-color="#DC1FFF"/>
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
                <span class="token-name">SOL</span>
              </div>
              <button
                class="refresh-btn"
                :class="{ 'is-loading': walletStore.loadingBalance }"
                :disabled="walletStore.loadingBalance"
                @click="refreshBalance"
              >
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M3 3v5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M16 16h5v5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
            <div class="balance-display">
              <span v-if="walletStore.loadingBalance" class="balance-loading">
                <span class="loading-dot"></span>
                <span class="loading-dot"></span>
                <span class="loading-dot"></span>
              </span>
              <template v-else>
                <span class="balance-value">{{ walletStore.solBalance }}</span>
                <span class="balance-usd">≈ $--</span>
              </template>
            </div>
          </div>
        </div>

        <!-- 操作区 -->
        <div class="actions-section">
          <button class="disconnect-btn" @click="handleDisconnect">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <polyline points="16,17 21,12 16,7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>断开连接</span>
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

/* ==================== 连接按钮 ==================== */
.connect-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  padding: 0 20px;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  overflow: hidden;
  isolation: isolate;
}

.connect-btn:disabled {
  cursor: not-allowed;
}

/* 动态渐变背景 */
.btn-bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, #9945FF 0%, #19FB9B 50%, #9945FF 100%);
  background-size: 200% 200%;
  animation: gradientShift 3s ease infinite;
  z-index: -2;
}

.connect-btn:hover .btn-bg {
  animation-duration: 1.5s;
}

@keyframes gradientShift {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}

/* 光晕效果 */
.btn-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.25) 0%, transparent 70%);
  opacity: 0;
  transition: opacity 0.3s;
  z-index: -1;
}

.connect-btn:hover .btn-glow {
  opacity: 1;
}

/* 按钮内容 */
.btn-content {
  display: flex;
  align-items: center;
  gap: 8px;
  color: white;
  font-weight: 600;
  font-size: 0.9rem;
  text-shadow: 0 1px 2px rgba(0,0,0,0.2);
}

.btn-icon {
  width: 18px;
  height: 18px;
}

.btn-text {
  white-space: nowrap;
}

/* 加载动画 */
.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 连接中状态 */
.connect-btn.is-connecting .btn-bg {
  animation: none;
  background: linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%);
}

/* ==================== 已连接按钮 ==================== */
.connected-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 14px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.connected-btn:hover {
  border-color: rgba(153, 69, 255, 0.5);
  box-shadow: 0 0 20px rgba(153, 69, 255, 0.15);
}

.connected-btn.is-open {
  border-color: #9945FF;
  box-shadow: 0 0 24px rgba(153, 69, 255, 0.2);
}

/* 实时状态指示器 */
.live-indicator {
  position: relative;
  width: 10px;
  height: 10px;
}

.live-dot {
  position: absolute;
  inset: 2px;
  background: #19FB9B;
  border-radius: 50%;
  z-index: 1;
}

.live-ring {
  position: absolute;
  inset: 0;
  border: 2px solid #19FB9B;
  border-radius: 50%;
  animation: ringPulse 2s ease-out infinite;
}

@keyframes ringPulse {
  0% {
    transform: scale(1);
    opacity: 0.8;
  }
  100% {
    transform: scale(2);
    opacity: 0;
  }
}

/* 地址显示 */
.address-display {
  display: flex;
  align-items: center;
}

.address-display .address-text {
  font-family: var(--sloth-font-mono, 'SF Mono', monospace);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--sloth-text);
  letter-spacing: 0.02em;
}

/* 下拉箭头 */
.chevron {
  width: 16px;
  height: 16px;
  color: var(--sloth-text-subtle);
  transition: transform 0.25s;
}

.connected-btn.is-open .chevron {
  transform: rotate(180deg);
}

/* ==================== 弹出面板 ==================== */
.wallet-panel {
  padding: 0;
}

/* 头部 */
.panel-header {
  position: relative;
  padding: 20px;
  border-radius: 12px 12px 0 0;
  overflow: hidden;
}

.header-bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(153, 69, 255, 0.15) 0%, rgba(25, 251, 155, 0.1) 100%);
  z-index: 0;
}

.header-content {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  z-index: 1;
}

.wallet-logo {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(83, 75, 177, 0.3);
}

.wallet-logo svg {
  width: 100%;
  height: 100%;
}

.wallet-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wallet-name {
  font-size: 1rem;
  font-weight: 600;
  color: var(--sloth-text);
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: #19FB9B;
}

.connection-status .status-dot {
  width: 6px;
  height: 6px;
  background: #19FB9B;
  border-radius: 50%;
  box-shadow: 0 0 8px rgba(25, 251, 155, 0.6);
}

/* 地址区块 */
.address-section {
  padding: 16px 20px;
  border-bottom: 1px solid var(--sloth-card-border);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.section-title {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--sloth-text-subtle);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.copy-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--sloth-bg-hover);
  border: 1px solid var(--sloth-card-border);
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--sloth-text-subtle);
  cursor: pointer;
  transition: all 0.2s;
}

.copy-btn svg {
  width: 12px;
  height: 12px;
}

.copy-btn:hover {
  background: var(--sloth-primary-dim);
  border-color: var(--sloth-primary);
  color: var(--sloth-primary);
}

.copy-btn.is-copied {
  background: rgba(25, 251, 155, 0.1);
  border-color: #19FB9B;
  color: #19FB9B;
}

.address-full {
  padding: 10px 12px;
  background: var(--sloth-bg);
  border: 1px solid var(--sloth-card-border);
  border-radius: 8px;
  font-family: var(--sloth-font-mono, monospace);
  font-size: 0.75rem;
  color: var(--sloth-text);
  word-break: break-all;
  line-height: 1.5;
}

/* 余额区块 */
.balance-section {
  padding: 16px 20px;
  border-bottom: 1px solid var(--sloth-card-border);
}

.balance-card {
  padding: 16px;
  background: linear-gradient(135deg, rgba(153, 69, 255, 0.08) 0%, rgba(25, 251, 155, 0.05) 100%);
  border: 1px solid rgba(153, 69, 255, 0.2);
  border-radius: 12px;
}

.balance-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.token-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.token-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  overflow: hidden;
}

.token-icon svg {
  width: 100%;
  height: 100%;
}

.token-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--sloth-text);
}

.refresh-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--sloth-bg);
  border: 1px solid var(--sloth-card-border);
  border-radius: 8px;
  color: var(--sloth-text-subtle);
  cursor: pointer;
  transition: all 0.2s;
}

.refresh-btn svg {
  width: 16px;
  height: 16px;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--sloth-primary-dim);
  border-color: var(--sloth-primary);
  color: var(--sloth-primary);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.refresh-btn.is-loading svg {
  animation: spin 1s linear infinite;
}

.balance-display {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.balance-value {
  font-family: var(--sloth-font-mono, monospace);
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--sloth-text);
  letter-spacing: -0.02em;
}

.balance-usd {
  font-size: 0.8rem;
  color: var(--sloth-text-subtle);
}

.balance-loading {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 42px;
}

.loading-dot {
  width: 8px;
  height: 8px;
  background: var(--sloth-text-subtle);
  border-radius: 50%;
  animation: loadingBounce 1.4s ease-in-out infinite both;
}

.loading-dot:nth-child(1) { animation-delay: -0.32s; }
.loading-dot:nth-child(2) { animation-delay: -0.16s; }

@keyframes loadingBounce {
  0%, 80%, 100% {
    transform: scale(0.6);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

/* 操作区 */
.actions-section {
  padding: 16px 20px;
}

.disconnect-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 10px;
  font-size: 0.875rem;
  font-weight: 500;
  color: #ef4444;
  cursor: pointer;
  transition: all 0.2s;
}

.disconnect-btn svg {
  width: 18px;
  height: 18px;
}

.disconnect-btn:hover {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.4);
}
</style>

<style>
/* 全局样式 - Web3 风格弹出框 */
.wallet-popover-web3 {
  padding: 0 !important;
  border-radius: 16px !important;
  border: 1px solid var(--sloth-card-border) !important;
  background: var(--sloth-card) !important;
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.1),
    0 20px 40px -4px rgba(0, 0, 0, 0.2),
    0 0 0 1px rgba(255, 255, 255, 0.05) inset !important;
  backdrop-filter: blur(20px) !important;
  overflow: hidden !important;
}

.wallet-popover-web3 .el-popover__title {
  display: none !important;
}

/* 暗黑模式增强 */
.dark .wallet-popover-web3 {
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.3),
    0 20px 40px -4px rgba(0, 0, 0, 0.5),
    0 0 60px -10px rgba(153, 69, 255, 0.15),
    0 0 0 1px rgba(255, 255, 255, 0.05) inset !important;
}

.dark .balance-card {
  background: linear-gradient(135deg, rgba(153, 69, 255, 0.12) 0%, rgba(25, 251, 155, 0.08) 100%);
}
</style>
