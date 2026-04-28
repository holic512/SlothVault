/**
 * 项目鉴权 Composable
 *
 * 提供项目访问权限验证功能
 * 结合钱包状态自动验证用户是否有权访问项目
 */

import { ref, computed, watch } from 'vue'

interface AuthState {
  /** 是否正在验证 */
  loading: boolean
  /** 是否有访问权限 */
  hasAccess: boolean
  /** 原因说明 */
  reason: string
  /** 项目是否需要鉴权 */
  requireAuth: boolean
  /** 匹配的 cNFT asset ID */
  assetId?: string
  /** 是否已验证过 */
  verified: boolean
}

interface VerifyAccessResponse {
  code: number
  data: {
    hasAccess: boolean
    reason: string
    assetId?: string
    requireAuth: boolean
  }
  message?: string
}

/**
 * 项目鉴权 Composable
 *
 * @param projectId - 项目 ID（响应式）
 * @param options - 配置选项
 */
export function useProjectAuth(
  projectId: Ref<string | null> | ComputedRef<string | null>,
  options: {
    /** 是否自动验证（当钱包连接状态变化时） */
    autoVerify?: boolean
    /** 是否强制链上验证 */
    forceChainVerify?: boolean
  } = {}
) {
  const { autoVerify = true, forceChainVerify = false } = options

  const walletStore = useWalletStore()

  // 鉴权状态
  const authState = ref<AuthState>({
    loading: false,
    hasAccess: false,
    reason: '',
    requireAuth: false,
    verified: false,
  })

  // 计算属性
  const isLoading = computed(() => authState.value.loading)
  const hasAccess = computed(() => authState.value.hasAccess)
  const reason = computed(() => authState.value.reason)
  const requireAuth = computed(() => authState.value.requireAuth)
  const needsWallet = computed(() => authState.value.requireAuth && !walletStore.connected)

  /**
   * 验证项目访问权限
   */
  async function verifyAccess(): Promise<boolean> {
    const id = projectId.value
    if (!id) {
      authState.value = {
        loading: false,
        hasAccess: false,
        reason: '项目 ID 无效',
        requireAuth: false,
        verified: true,
      }
      return false
    }

    authState.value.loading = true

    try {
      const response = await $fetch<VerifyAccessResponse>(
        `/api/project/${id}/verify-access`,
        {
          method: 'POST',
          body: {
            walletAddress: walletStore.publicKey,
            forceChainVerify,
          },
        }
      )

      if (response.code === 0 && response.data) {
        authState.value = {
          loading: false,
          hasAccess: response.data.hasAccess,
          reason: response.data.reason,
          requireAuth: response.data.requireAuth,
          assetId: response.data.assetId,
          verified: true,
        }
        return response.data.hasAccess
      } else {
        authState.value = {
          loading: false,
          hasAccess: false,
          reason: response.message || '验证失败',
          requireAuth: false,
          verified: true,
        }
        return false
      }
    } catch (error: any) {
      const message = error?.data?.message || error?.message || '验证请求失败'
      authState.value = {
        loading: false,
        hasAccess: false,
        reason: message,
        requireAuth: true,
        verified: true,
      }
      return false
    }
  }

  /**
   * 重置鉴权状态
   */
  function resetAuth() {
    authState.value = {
      loading: false,
      hasAccess: false,
      reason: '',
      requireAuth: false,
      verified: false,
    }
  }

  /**
   * 获取带钱包地址的 API 请求参数
   */
  function getAuthQuery(): Record<string, string> {
    if (walletStore.publicKey) {
      return { walletAddress: walletStore.publicKey }
    }
    return {}
  }

  /**
   * 获取带钱包地址的 API 请求头
   */
  function getAuthHeaders(): Record<string, string> {
    if (walletStore.publicKey) {
      return { 'X-Wallet-Address': walletStore.publicKey }
    }
    return {}
  }

  // 自动验证：当项目 ID 或钱包状态变化时
  if (autoVerify) {
    // 监听项目 ID 变化
    watch(
      () => projectId.value,
      (newId) => {
        if (newId) {
          verifyAccess()
        } else {
          resetAuth()
        }
      },
      { immediate: true }
    )

    // 监听钱包连接状态变化
    watch(
      () => walletStore.connected,
      () => {
        if (projectId.value) {
          verifyAccess()
        }
      }
    )

    // 监听钱包地址变化（切换账户）
    watch(
      () => walletStore.publicKey,
      (newKey, oldKey) => {
        if (newKey !== oldKey && projectId.value) {
          verifyAccess()
        }
      }
    )
  }

  return {
    // 状态
    authState: readonly(authState),
    isLoading,
    hasAccess,
    reason,
    requireAuth,
    needsWallet,

    // 方法
    verifyAccess,
    resetAuth,
    getAuthQuery,
    getAuthHeaders,
  }
}

/**
 * 项目列表鉴权 Composable
 *
 * 用于批量检查项目列表的访问权限
 */
export function useProjectListAuth() {
  const walletStore = useWalletStore()

  // 项目访问权限映射
  const accessMap = ref<Map<string, boolean>>(new Map())
  const loading = ref(false)

  /**
   * 检查单个项目是否有访问权限
   */
  function hasAccess(projectId: string, requireAuth: boolean): boolean {
    // 不需要鉴权的项目直接返回 true
    if (!requireAuth) return true

    // 需要鉴权但未连接钱包
    if (!walletStore.connected) return false

    // 从缓存中获取
    return accessMap.value.get(projectId) ?? false
  }

  /**
   * 批量验证项目访问权限
   */
  async function batchVerify(projectIds: string[]): Promise<void> {
    if (!walletStore.connected || projectIds.length === 0) {
      return
    }

    loading.value = true

    try {
      // 逐个验证（可以优化为批量 API）
      for (const id of projectIds) {
        try {
          const response = await $fetch<VerifyAccessResponse>(
            `/api/project/${id}/verify-access`,
            {
              method: 'POST',
              body: {
                walletAddress: walletStore.publicKey,
              },
            }
          )

          if (response.code === 0 && response.data) {
            accessMap.value.set(id, response.data.hasAccess)
          }
        } catch {
          accessMap.value.set(id, false)
        }
      }
    } finally {
      loading.value = false
    }
  }

  /**
   * 清除缓存
   */
  function clearCache() {
    accessMap.value.clear()
  }

  // 钱包状态变化时清除缓存
  watch(
    () => walletStore.publicKey,
    () => {
      clearCache()
    }
  )

  return {
    accessMap: readonly(accessMap),
    loading: readonly(loading),
    hasAccess,
    batchVerify,
    clearCache,
  }
}
