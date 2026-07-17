<script setup lang="ts">
import { HomeIcon } from '@heroicons/vue/24/outline'

const { t } = useI18n()
</script>

<template>
  <NuxtLink to="/" class="home-btn" :title="t('AdminMM.header.backHome')">
    <HomeIcon class="home-icon" />
  </NuxtLink>
</template>

<style scoped>
.home-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  border: 1px solid var(--sloth-card-border);
  background: var(--sloth-card);
  color: var(--sloth-text);
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  backdrop-filter: blur(16px);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  text-decoration: none;
}

.home-btn:hover {
  background: var(--sloth-bg-hover);
  border-color: var(--sloth-primary);
  color: var(--sloth-primary);
  transform: translateY(-1px);
}

.home-btn:active {
  transform: scale(0.98);
}

.home-icon {
  width: 18px;
  height: 18px;
}
</style>
