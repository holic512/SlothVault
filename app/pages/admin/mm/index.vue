<script setup lang="ts">
definePageMeta({
  layout: 'admin-mm'
})

const { t } = useI18n()
</script>

<template>
  <div class="page-container">
    <div class="page-header">
      <h1>{{ t('AdminMM.menu.dashboard') }}</h1>
    </div>
    
    <div class="sloth-card empty-state">
      <p>Dashboard is currently empty.</p>
    </div>
  </div>
</template>

<style scoped>
.page-header {
  margin-bottom: 24px;
}

.empty-state {
  padding: 40px;
  text-align: center;
  color: var(--sloth-text-secondary);
}
</style>
