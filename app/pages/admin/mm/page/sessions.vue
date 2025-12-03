<script setup lang="ts">
definePageMeta({
  layout: 'admin-mm'
})

const { t } = useI18n()
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <h1>{{ t('AdminMM.sessions.title') }}</h1>
    </div>
    <div class="sloth-card">
      <el-empty description="Session Status Coming Soon" />
    </div>
  </div>
</template>

<style scoped>
.page-header {
  margin-bottom: 24px;
}
</style>
