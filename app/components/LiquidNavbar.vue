<script setup lang="ts">
import { HomeIcon, RectangleGroupIcon } from '@heroicons/vue/24/outline'

const { t } = useI18n()
</script>

<template>
  <nav class="liquid-navbar">
    <LiquidGlassCard :border-radius="18" :blur="16" padding="8px 24px" :bg-opacity="0.7">
      <div class="liquid-nav-content">
        <!--  logo  -->
        <NuxtLink to="/" class="liquid-brand">
          <img src="/logo.png" class="liquid-brand-icon" alt="Logo"/>
          <span class="liquid-brand-text">Sloth<span class="sloth-text-gradient">Vault</span></span>
        </NuxtLink>

        <!-- 导航链接 -->
        <div class="liquid-nav-links">
          <NuxtLink to="/" class="liquid-nav-link">
            <HomeIcon class="liquid-nav-icon"/>
            <span>{{ t('Nav.home') }}</span>
          </NuxtLink>
          <NuxtLink to="/project/projectList" class="liquid-nav-link">
            <RectangleGroupIcon class="liquid-nav-icon"/>
            <span>{{ t('Nav.projects') }}</span>
          </NuxtLink>
        </div>

        <!--  主题切换  -->
        <ThemeToggle/>
      </div>
    </LiquidGlassCard>
  </nav>
</template>

<style scoped>
.liquid-navbar {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  width: 100%;
  max-width: 1000px;
  padding: 0 20px;
  box-sizing: border-box;
}

.liquid-nav-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  width: 100%;
}

.liquid-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  flex-shrink: 0;
}

.liquid-brand-icon {
  width: 28px;
  height: 28px;
}

.liquid-brand-text {
  font-weight: 700;
  font-size: 1.1rem;
  color: var(--sloth-text);
}

.liquid-nav-links {
  display: flex;
  align-items: center;
  gap: 8px;
}

.liquid-nav-link {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--sloth-text);
  text-decoration: none;
  border-radius: 12px;
  transition: all 0.2s ease;
}

.liquid-nav-link:hover {
  color: var(--sloth-primary);
  background: rgba(var(--sloth-primary-rgb), 0.1);
}

.liquid-nav-link.router-link-active {
  color: var(--sloth-primary);
  background: rgba(var(--sloth-primary-rgb), 0.15);
}

.liquid-nav-icon {
  width: 18px;
  height: 18px;
}

/* Mobile 适配 */
@media (max-width: 768px) {
  .liquid-navbar {
    top: 10px;
    padding: 0 10px;
  }

  .liquid-nav-content {
    gap: 12px;
  }

  .liquid-brand-text {
    font-size: 1rem;
  }

  .liquid-nav-links {
    gap: 4px;
  }

  .liquid-nav-link {
    padding: 6px 10px;
    font-size: 0.85rem;
  }

  .liquid-nav-link span {
    display: none;
  }

  .liquid-nav-icon {
    width: 20px;
    height: 20px;
  }
}
</style>
