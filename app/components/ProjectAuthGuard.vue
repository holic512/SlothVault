<script setup lang="ts">
/**
 * 项目鉴权守卫组件
 *
 * 用于包裹需要鉴权的项目内容
 * 自动处理鉴权状态展示和钱包连接引导
 */

const props = defineProps<{
  /** 项目 ID */
  projectId: string
  /** 是否显示加载状态 */
  showLoading?: boolean
  /** 是否显示鉴权失败状态 */
  showAuthFailed?: boolean
}>()

const emit = defineEmits<{
  /** 鉴权状态变化 */
  (e: 'authChange', hasAccess: boolean): void
  /** 验证完成 */
  (e: 'verified', result: { hasAccess: boolean; reason: string }): void
}>()

const { t } = useI18n()
const walletStore = useWalletStore()
const message = useMessage()

// 使用项目鉴权 composable
const projectIdRef = computed(() => props.projectId)
const {
  isLoading,
  hasAccess,
  reason,
  requireAuth,
  needsWallet,
  verifyAccess,
} = useProjectAuth(projectIdRef)

// 监听鉴权状态变化
watch(hasAccess, (value) => {
  emit('authChange', value)
})

// 监听验证完成
watch(
  [isLoading, hasAccess, reason],
  ([loading, access, msg]) => {
    if (!loading) {
      emit('verified', { hasAccess: access, reason: msg })
    }
  }
)

// 连接钱包
async function handleConnect() {
  try {
    await walletStore.connect()
    message.success(t('projectAuth.walletConnected'))
  } catch (err: any) {
    message.error(err.message || t('projectAuth.connectFailed'))
  }
}

// 重试验证
async function handleRetry() {
  await verifyAccess()
}
</script>

<template>
  <div class="project-auth-guard">
    <!-- 加载中 -->
    <div v-if="isLoading && showLoading !== false" class="auth-loading">
      <div class="auth-loading-card">
        <div class="loading-animation">
          <div class="loading-ring"></div>
          <div class="loading-ring"></div>
          <div class="loading-ring"></div>
        </div>
        <span class="loading-text">{{ t('projectAuth.verifying') }}</span>
      </div>
    </div>

    <!-- 需要连接钱包 -->
    <div v-else-if="needsWallet && showAuthFailed !== false" class="auth-state-wrapper">
      <div class="auth-card auth-connect-wallet">
        <!-- 装饰背景 -->
        <div class="auth-card-bg">
          <div class="bg-gradient"></div>
          <div class="bg-pattern"></div>
        </div>

        <div class="auth-card-content">
          <!-- 图标区域 -->
          <div class="auth-icon-wrapper">
            <div class="auth-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/>
                <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>
              </svg>
            </div>
            <div class="icon-pulse"></div>
          </div>

          <!-- 文字内容 -->
          <h3 class="auth-title">{{ t('projectAuth.connectWallet.title') }}</h3>
          <p class="auth-desc">{{ t('projectAuth.connectWallet.desc') }}</p>

          <!-- 步骤提示 -->
          <div class="auth-steps">
            <div class="step-item">
              <div class="step-number">1</div>
              <span>{{ t('projectAuth.connectWallet.step1') }}</span>
            </div>
            <div class="step-divider"></div>
            <div class="step-item">
              <div class="step-number">2</div>
              <span>{{ t('projectAuth.connectWallet.step2') }}</span>
            </div>
            <div class="step-divider"></div>
            <div class="step-item">
              <div class="step-number">3</div>
              <span>{{ t('projectAuth.connectWallet.step3') }}</span>
            </div>
          </div>

          <!-- 连接按钮 -->
          <button class="auth-connect-btn" @click="handleConnect">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/>
              <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>
            </svg>
            <span>{{ t('projectAuth.connectWallet.btn') }}</span>
          </button>

          <!-- 底部提示 -->
          <p class="auth-footer-hint">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4"/>
              <path d="M12 8h.01"/>
            </svg>
            {{ t('projectAuth.connectWallet.hint') }}
          </p>
        </div>
      </div>
    </div>

    <!-- 鉴权失败 - 无权限 -->
    <div v-else-if="!hasAccess && requireAuth && showAuthFailed !== false" class="auth-state-wrapper">
      <div class="auth-card auth-failed">
        <!-- 装饰背景 -->
        <div class="auth-card-bg auth-card-bg-error">
          <div class="bg-gradient"></div>
          <div class="bg-pattern"></div>
        </div>

        <div class="auth-card-content">
          <!-- 图标区域 -->
          <div class="auth-icon-wrapper">
            <div class="auth-icon auth-icon-error">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
            </div>
          </div>

          <!-- 文字内容 -->
          <h3 class="auth-title">{{ t('projectAuth.noAccess.title') }}</h3>
          <p class="auth-desc">{{ reason || t('projectAuth.noAccess.desc') }}</p>

          <!-- 信息卡片 -->
          <div class="auth-info-card">
            <div class="info-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <div class="info-content">
              <div class="info-title">{{ t('projectAuth.noAccess.infoTitle') }}</div>
              <div class="info-text">{{ t('projectAuth.noAccess.infoText') }}</div>
            </div>
          </div>

          <!-- 操作按钮 -->
          <div class="auth-actions">
            <button class="auth-retry-btn" @click="handleRetry">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                <path d="M16 16h5v5"/>
              </svg>
              <span>{{ t('projectAuth.noAccess.retryBtn') }}</span>
            </button>
          </div>

          <!-- 底部提示 -->
          <p class="auth-footer-hint">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            {{ t('projectAuth.noAccess.contactHint') }}
          </p>
        </div>
      </div>
    </div>

    <!-- 有权限，显示内容 -->
    <slot v-else />
  </div>
</template>

<style scoped>
.project-auth-guard {
  width: 100%;
  min-height: 200px;
}

/* 状态包装器 - 居中显示 */
.auth-state-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 120px);
  padding: 40px 20px;
}

/* ==================== 加载状态 ==================== */
.auth-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 120px);
  padding: 40px 20px;
}

.auth-loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  padding: 48px 64px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: 24px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
}

.loading-animation {
  position: relative;
  width: 64px;
  height: 64px;
}

.loading-ring {
  position: absolute;
  inset: 0;
  border: 3px solid transparent;
  border-radius: 50%;
  animation: loading-spin 1.5s ease-in-out infinite;
}

.loading-ring:nth-child(1) {
  border-top-color: #9945FF;
  animation-delay: 0s;
}

.loading-ring:nth-child(2) {
  border-right-color: #14F195;
  animation-delay: 0.15s;
  inset: 6px;
}

.loading-ring:nth-child(3) {
  border-bottom-color: #9945FF;
  animation-delay: 0.3s;
  inset: 12px;
}

@keyframes loading-spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.loading-text {
  font-size: 1rem;
  color: var(--sloth-text-secondary);
  font-weight: 500;
}

/* ==================== 鉴权卡片通用样式 ==================== */
.auth-card {
  position: relative;
  width: 100%;
  max-width: 480px;
  border-radius: 24px;
  overflow: hidden;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
}

/* 卡片背景装饰 */
.auth-card-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.bg-gradient {
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(
    circle at 30% 20%,
    rgba(153, 69, 255, 0.08) 0%,
    transparent 50%
  ),
  radial-gradient(
    circle at 70% 80%,
    rgba(20, 241, 149, 0.06) 0%,
    transparent 50%
  );
  animation: bg-rotate 20s linear infinite;
}

@keyframes bg-rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.bg-pattern {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(
    rgba(153, 69, 255, 0.03) 1px,
    transparent 1px
  );
  background-size: 24px 24px;
}

.auth-card-bg-error .bg-gradient {
  background: radial-gradient(
    circle at 30% 20%,
    rgba(239, 68, 68, 0.08) 0%,
    transparent 50%
  ),
  radial-gradient(
    circle at 70% 80%,
    rgba(251, 146, 60, 0.06) 0%,
    transparent 50%
  );
}

.auth-card-bg-error .bg-pattern {
  background-image: radial-gradient(
    rgba(239, 68, 68, 0.03) 1px,
    transparent 1px
  );
}

/* 卡片内容 */
.auth-card-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 40px;
  text-align: center;
}

/* ==================== 图标区域 ==================== */
.auth-icon-wrapper {
  position: relative;
  margin-bottom: 24px;
}

.auth-icon {
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(153, 69, 255, 0.15) 0%, rgba(20, 241, 149, 0.1) 100%);
  border-radius: 20px;
  border: 1px solid rgba(153, 69, 255, 0.2);
}

.auth-icon svg {
  width: 40px;
  height: 40px;
  color: #9945FF;
}

.auth-icon-error {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(251, 146, 60, 0.1) 100%);
  border-color: rgba(239, 68, 68, 0.2);
}

.auth-icon-error svg {
  color: #ef4444;
}

/* 脉冲动画 */
.icon-pulse {
  position: absolute;
  inset: -8px;
  border-radius: 28px;
  border: 2px solid rgba(153, 69, 255, 0.3);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.1);
    opacity: 0;
  }
}

/* ==================== 文字内容 ==================== */
.auth-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--sloth-text);
  margin-bottom: 12px;
  letter-spacing: -0.02em;
}

.auth-desc {
  font-size: 1rem;
  color: var(--sloth-text-secondary);
  line-height: 1.6;
  max-width: 360px;
  margin-bottom: 8px;
}

/* ==================== 步骤提示 ==================== */
.auth-steps {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 28px 0;
  padding: 20px 24px;
  background: var(--sloth-bg-hover);
  border-radius: 16px;
  border: 1px solid var(--sloth-card-border);
}

.step-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.step-number {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #9945FF 0%, #14F195 100%);
  border-radius: 50%;
  font-size: 0.85rem;
  font-weight: 700;
  color: white;
}

.step-item span {
  font-size: 0.8rem;
  color: var(--sloth-text-secondary);
  text-align: center;
  line-height: 1.4;
}

.step-divider {
  width: 24px;
  height: 2px;
  background: linear-gradient(90deg, #9945FF, #14F195);
  border-radius: 1px;
  opacity: 0.5;
  flex-shrink: 0;
}

/* ==================== 信息卡片 ==================== */
.auth-info-card {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin: 24px 0;
  padding: 20px;
  background: rgba(239, 68, 68, 0.05);
  border: 1px solid rgba(239, 68, 68, 0.15);
  border-radius: 16px;
  text-align: left;
  width: 100%;
}

.info-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(239, 68, 68, 0.1);
  border-radius: 10px;
  flex-shrink: 0;
}

.info-icon svg {
  width: 20px;
  height: 20px;
  color: #ef4444;
}

.info-content {
  flex: 1;
}

.info-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--sloth-text);
  margin-bottom: 4px;
}

.info-text {
  font-size: 0.85rem;
  color: var(--sloth-text-secondary);
  line-height: 1.5;
}

/* ==================== 按钮样式 ==================== */
.auth-connect-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  max-width: 280px;
  padding: 16px 32px;
  background: linear-gradient(135deg, #9945FF 0%, #14F195 100%);
  border: none;
  border-radius: 14px;
  font-size: 1rem;
  font-weight: 600;
  color: white;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 4px 16px rgba(153, 69, 255, 0.3);
}

.auth-connect-btn:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 24px rgba(153, 69, 255, 0.4);
}

.auth-connect-btn:active {
  transform: translateY(-1px);
}

.auth-connect-btn svg {
  width: 22px;
  height: 22px;
}

.auth-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.auth-retry-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 28px;
  background: var(--sloth-bg-hover);
  border: 1px solid var(--sloth-card-border);
  border-radius: 12px;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--sloth-text);
  cursor: pointer;
  transition: all 0.2s;
}

.auth-retry-btn:hover {
  background: var(--sloth-primary-dim);
  border-color: var(--sloth-primary);
  color: var(--sloth-primary);
  transform: translateY(-2px);
}

.auth-retry-btn svg {
  width: 18px;
  height: 18px;
}

/* ==================== 底部提示 ==================== */
.auth-footer-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--sloth-card-border);
  font-size: 0.85rem;
  color: var(--sloth-text-subtle);
  width: 100%;
  justify-content: center;
}

.auth-footer-hint svg {
  width: 16px;
  height: 16px;
  opacity: 0.7;
  flex-shrink: 0;
}

/* ==================== 响应式 ==================== */
@media (max-width: 768px) {
  .auth-state-wrapper,
  .auth-loading {
    min-height: calc(100vh - 80px);
    padding: 24px 16px;
  }

  .auth-card-content {
    padding: 36px 24px;
  }

  .auth-icon {
    width: 64px;
    height: 64px;
  }

  .auth-icon svg {
    width: 32px;
    height: 32px;
  }

  .auth-title {
    font-size: 1.25rem;
  }

  .auth-desc {
    font-size: 0.9rem;
  }

  .auth-steps {
    flex-direction: column;
    gap: 16px;
    padding: 16px;
  }

  .step-item {
    flex-direction: row;
    gap: 12px;
    width: 100%;
  }

  .step-divider {
    width: 2px;
    height: 16px;
  }

  .auth-connect-btn {
    padding: 14px 24px;
    font-size: 0.95rem;
  }

  .auth-info-card {
    padding: 16px;
  }
}

@media (max-width: 480px) {
  .auth-card {
    border-radius: 20px;
  }

  .auth-card-content {
    padding: 28px 20px;
  }

  .auth-steps {
    margin: 20px 0;
  }
}
</style>
