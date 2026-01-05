<script setup lang="ts">
/**
 * Solana 链上管理 - 父页面
 *
 * 功能：
 * - 页面头部展示
 * - 网络切换（主网/测试网）
 * - Tab 路由导航
 *
 * Requirements: 7.3, 11.1, 11.2
 */
import { ElMessage, ElMessageBox } from 'element-plus'

definePageMeta({
  layout: 'admin-mm',
})

const { t } = useI18n()

// ============ 状态管理 ============
// 网络配置
const currentNetwork = ref<'mainnet' | 'devnet'>('devnet')
const networkLoading = ref(false)

// 路由
const route = useRoute()
const router = useRouter()

// 当前激活的 Tab（根据路由判断）
const activeTab = computed(() => {
  const path = route.path
  if (path.endsWith('/cnfts')) return 'cnfts'
  return 'trees'
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
    console.error(t('AdminMM.solana.network.fetchConfigFailed'), err)
  }
}

// 切换网络（Requirements 11.1, 11.2）
// 注意：使用 @click 而非 @change，避免 v-model 先行更新状态
async function handleNetworkClick(network: 'mainnet' | 'devnet') {
  // 如果点击的是当前网络，不处理
  if (network === currentNetwork.value) return

  // 切换到主网需要二次确认
  if (network === 'mainnet') {
    try {
      await ElMessageBox.confirm(
        t('AdminMM.solana.network.switchWarning'),
        t('AdminMM.solana.network.switchToMainnet'),
        { 
          confirmButtonText: t('AdminMM.solana.network.confirmSwitch'), 
          cancelButtonText: t('AdminMM.solana.network.cancel'), 
          type: 'warning' 
        }
      )
    } catch {
      // 用户取消，不做任何操作
      return
    }
  }

  // 确认后才执行切换
  networkLoading.value = true
  try {
    const res = await $fetch<{ code: number; message: string }>('/api/admin/solana/config', {
      method: 'PUT',
      body: { network },
    })
    if (res.code === 0) {
      currentNetwork.value = network
      ElMessage.success(res.message)
    }
  } catch (err: any) {
    ElMessage.error(err.message || t('AdminMM.solana.network.switchFailed'))
  } finally {
    networkLoading.value = false
  }
}

// Tab 切换（路由导航）
function handleTabChange(tab: string) {
  if (tab === 'trees') {
    router.push('/admin/mm/solana/trees')
  } else if (tab === 'cnfts') {
    router.push('/admin/mm/solana/cnfts')
  }
}

// ============ 生命周期 ============
onMounted(async () => {
  await fetchNetworkConfig()
})

// 向子路由提供网络状态
provide('solanaNetwork', currentNetwork)
provide('refreshNetwork', fetchNetworkConfig)
</script>

<template>
  <div class="solana-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">{{ $t('AdminMM.solana.title') }}</h1>
        <p class="page-desc">{{ $t('AdminMM.solana.desc') }}</p>
      </div>
      <div class="header-right">
        <!-- 网络切换：使用单向绑定 + 点击事件，避免 v-model 先行更新 -->
        <div class="network-switch">
          <span class="network-label">{{ $t('AdminMM.solana.network.label') }}</span>
          <el-radio-group
            :model-value="currentNetwork"
            size="small"
            :disabled="networkLoading"
          >
            <el-radio-button value="devnet" @click="handleNetworkClick('devnet')">
              <span class="network-dot devnet"></span>
              {{ $t('AdminMM.solana.network.devnet') }}
            </el-radio-button>
            <el-radio-button value="mainnet" @click="handleNetworkClick('mainnet')">
              <span class="network-dot mainnet"></span>
              {{ $t('AdminMM.solana.network.mainnet') }}
            </el-radio-button>
          </el-radio-group>
        </div>
      </div>
    </div>

    <!-- Tab 切换 -->
    <div class="tab-container">
      <el-tabs :model-value="activeTab" class="custom-tabs" @tab-change="handleTabChange">
        <el-tab-pane :label="$t('AdminMM.solana.tabs.trees')" name="trees" />
        <el-tab-pane :label="$t('AdminMM.solana.tabs.cnfts')" name="cnfts" />
      </el-tabs>
    </div>

    <!-- 子路由内容 -->
    <NuxtPage :network="currentNetwork" />
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

/* Tab 容器 */
.tab-container {
  margin-bottom: 12px;
  padding: 0 12px;
  background: var(--sloth-card);
  border: 1px solid var(--sloth-card-border);
  border-radius: var(--sloth-radius);
  backdrop-filter: blur(var(--sloth-blur));
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

/* Tabs 主题适配 */
:deep(.el-tabs) {
  --el-tabs-header-height: 40px;
}

:deep(.el-tabs__header) {
  margin: 0;
}

:deep(.el-tabs__nav-wrap::after) {
  display: none;
}

:deep(.el-tabs__item) {
  font-size: 13px;
  color: var(--sloth-text-subtle);
  padding: 0 16px;
}

:deep(.el-tabs__item:hover) {
  color: var(--sloth-primary);
}

:deep(.el-tabs__item.is-active) {
  color: var(--sloth-primary);
  font-weight: 600;
}

:deep(.el-tabs__active-bar) {
  background-color: var(--sloth-primary);
}

@media (max-width: 960px) {
  .page-header {
    flex-direction: column;
    gap: 12px;
  }
}
</style>
