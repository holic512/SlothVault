<script setup lang="ts">
/**
 * Solana 管理默认页面
 * 重定向到 trees 子路由
 */
const router = useRouter()

onMounted(() => {
  router.replace('/admin/mm/solana/trees')
})
</script>

<template>
  <div class="redirect-loading">
    <el-skeleton :rows="5" animated />
  </div>
</template>

<style scoped>
.redirect-loading {
  padding: 20px;
}
</style>
