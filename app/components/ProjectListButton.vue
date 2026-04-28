<template>
  <NuxtLink to="/project/projectList" class="project-list-btn" title="项目列表">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" class="btn-icon">
      <rect x="3" y="3" width="7" height="7" rx="1"></rect>
      <rect x="14" y="3" width="7" height="7" rx="1"></rect>
      <rect x="3" y="14" width="7" height="7" rx="1"></rect>
      <rect x="14" y="14" width="7" height="7" rx="1"></rect>
    </svg>
  </NuxtLink>
</template>

<script setup lang="ts">
</script>

<style scoped>
.project-list-btn {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: var(--sloth-card, rgba(255, 255, 255, 0.9));
  border: 1px solid var(--sloth-card-border, rgba(0, 0, 0, 0.06));
  color: var(--sloth-text, #333);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  backdrop-filter: blur(16px);
  text-decoration: none;
}

.btn-icon {
  width: 20px;
  height: 20px;
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.project-list-btn:hover {
  background: var(--sloth-bg-hover, rgba(0, 0, 0, 0.04));
  border-color: var(--sloth-primary);
}

.project-list-btn:hover .btn-icon {
  transform: scale(1.1);
  color: var(--sloth-primary);
}

.project-list-btn:active {
  transform: scale(0.95);
}
</style>
