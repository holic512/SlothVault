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
    
    <div class="sloth-grid">
      <div class="sloth-card">
        <div class="sloth-stat-label">Total Users</div>
        <div class="sloth-stat-value">0</div>
      </div>
      
      <div class="sloth-card">
        <div class="sloth-stat-label">Active Sessions</div>
        <div class="sloth-stat-value">0</div>
      </div>
      
      <div class="sloth-card">
        <div class="sloth-stat-label">System Status</div>
        <div class="sloth-stat-value" style="color: var(--sloth-primary)">Healthy</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-header {
  margin-bottom: 24px;
}
</style>
