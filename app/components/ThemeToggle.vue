<!--主题切换组件-->
<template>
  <div class="theme-manager" ref="containerRef">
    <el-popover
      v-model:visible="isOpen"
      placement="bottom-end"
      :width="220"
      trigger="click"
      popper-class="theme-popover-custom"
      :show-arrow="false"
    >
      <template #reference>
        <!-- 触发器按钮 -->
        <button
            class="main-trigger"
            :class="{ 'is-open': isOpen }"
            :aria-label="t('ThemeToggle.aria.openThemeSettings')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" class="trigger-icon">
            <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>
          </svg>
        </button>
      </template>

      <!-- 弹出框内容 -->
      <div class="theme-popover-content">

        <div class="section-group">
          <div class="section-title">{{ t('ThemeToggle.section.mode') }}</div>
          <div class="mode-switch">
            <button
                @click="handleThemeChange('light', $event)"
                :class="['mode-opt', { active: theme !== 'dark' }]"
                :title="t('ThemeToggle.mode.light_title')"
            >
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="5"></circle>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
              </svg>
              <span>{{ t('ThemeToggle.mode.light') }}</span>
            </button>
            <button
                @click="handleThemeChange('dark', $event)"
                :class="['mode-opt', { active: theme === 'dark' }]"
                :title="t('ThemeToggle.mode.dark_title')"
            >
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
              <span>{{ t('ThemeToggle.mode.dark') }}</span>
            </button>
          </div>
        </div>

        <div class="divider"></div>

        <div class="section-group">
          <div class="section-title">{{ t('ThemeToggle.section.language') }}</div>
          <div class="mode-switch">
            <button
                @click="applyLocale('zh')"
                :class="['mode-opt', { active: localeStore.locale === 'zh' }]"
            >
              <span>{{ t('ThemeToggle.language.zh') }}</span>
            </button>
            <button
                @click="applyLocale('en')"
                :class="['mode-opt', { active: localeStore.locale === 'en' }]"
            >
              <span>{{ t('ThemeToggle.language.en') }}</span>
            </button>
          </div>
        </div>

        <div class="divider"></div>

        <div class="section-group">
          <div class="section-title">{{ t('ThemeToggle.section.color') }}</div>
          <div class="palette-grid">
            <button
                v-for="(p, index) in palettes"
                :key="p"
                :class="['color-swatch', 'swatch-' + p, { active: palette === p }]"
                :style="{ '--delay': index * 50 + 'ms' }"
                @click="handlePaletteChange(p, $event)"
                :title="t('ThemeToggle.palette.' + p)"
            >
              <span class="swatch-ring"></span>
              <transition name="check-pop">
                <svg v-if="palette === p" class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </transition>
            </button>
          </div>
        </div>

      </div>
    </el-popover>
  </div>
</template>

<script setup>
import { ref, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useTheme } from '~/stores/useTheme'
import { useLocaleStore } from '~/stores/locale'
import { ElPopover } from 'element-plus'

// 假设你有全局 auto-import 或请自行引入 useI18n
const { t, setLocale } = useI18n()

const themeStore = useTheme()
const { theme, palette } = storeToRefs(themeStore)
const { setTheme, setPalette: setStorePalette } = themeStore
const palettes = ['purple', 'cyan', 'emerald', 'rose']

const localeStore = useLocaleStore()
const isOpen = ref(false)

const applyLocale = (l) => {
  localeStore.setLocale(l)
  setLocale(l)
}

/**
 * 核心优化：高性能圆扩动画通用函数
 * 使用 View Transition API，不操作 DOM 节点，完全无卡顿
 */
const performTransition = async (event, callback) => {
  // 1. 如果浏览器不支持 View Transition，直接降级执行
  if (!document.startViewTransition) {
    callback()
    return
  }

  // 2. 获取点击坐标
  const x = event.clientX
  const y = event.clientY

  // 3. 计算从点击点到屏幕最远角的距离（即圆的最大半径）
  const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
  )

  // 4. 开启视图过渡
  // 浏览器会先截图当前状态(old)，执行 callback 变色，再截图新状态(new)
  const transition = document.startViewTransition(async () => {
    callback()
    await nextTick() // 等待 DOM 更新完毕
  })

  // 5. 自定义扩散动画
  transition.ready.then(() => {
    // 这是一个原生动画，运行在 compositor 线程，不会阻塞 JS 主线程
    document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`
          ]
        },
        {
          duration: 500, // 500ms 丝滑过渡
          easing: 'ease-in',
          // 指定动画作用于“新视图”的伪元素上
          pseudoElement: '::view-transition-new(root)'
        }
    )
  })
}

// 主题切换
const handleThemeChange = (mode, event) => {
  if (theme.value === mode) return
  performTransition(event, () => setTheme(mode))
}

// 颜色切换
const handlePaletteChange = (p, event) => {
  if (palette.value === p) return
  performTransition(event, () => setStorePalette(p))
}
</script>

<style scoped>
/* =========== UI 样式保持不变 =========== */
.theme-manager {
  position: relative;
  display: inline-block;
  --pop-bg: var(--sloth-card, rgba(255, 255, 255, 0.9));
  --pop-border: var(--sloth-card-border, rgba(0, 0, 0, 0.06));
  --pop-blur: 16px;
  --primary: var(--sloth-primary, #7c3aed);
  --text: var(--sloth-text, #333);
  --text-dim: rgba(120, 120, 120, 0.7);
}

/* 触发器按钮 */
.main-trigger {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: var(--pop-bg);
  border: 1px solid var(--pop-border);
  color: var(--text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  backdrop-filter: blur(var(--pop-blur));
}

.trigger-icon {
  width: 20px;
  height: 20px;
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.main-trigger:hover {
  background: var(--sloth-bg-hover, rgba(0, 0, 0, 0.04));
  border-color: var(--primary);
}

.main-trigger:hover .trigger-icon {
  transform: rotate(15deg) scale(1.1);
  color: var(--primary);
}

.main-trigger:active {
  transform: scale(0.95);
}

.main-trigger.is-open {
  background: var(--primary);
  color: white;
  border-color: var(--primary);
}

.main-trigger.is-open .trigger-icon {
  transform: rotate(180deg);
}

/* 弹出面板内容 */
.theme-popover-content {
  padding: 0;
  animation: fadeSlideIn 0.3s ease forwards;
}

/* 区域样式 */
.section-group {
  animation: fadeSlideIn 0.3s ease forwards;
  opacity: 0;
}

.section-group:nth-child(1) { animation-delay: 0ms; }
.section-group:nth-child(3) { animation-delay: 50ms; }
.section-group:nth-child(5) { animation-delay: 100ms; }

@keyframes fadeSlideIn {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.section-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  color: var(--text-dim);
  font-weight: 600;
  margin-bottom: 8px;
}

.divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--pop-border), transparent);
  margin: 12px 0;
}

/* 明暗/语言切换 */
.mode-switch {
  display: flex;
  background: rgba(0, 0, 0, 0.03);
  padding: 3px;
  border-radius: 10px;
  gap: 3px;
}

:global(.dark) .mode-switch {
  background: rgba(255, 255, 255, 0.06);
}

.mode-opt {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.mode-opt::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--primary);
  opacity: 0;
  transition: opacity 0.2s;
}

.mode-opt:hover::before {
  opacity: 0.05;
}

.mode-opt .icon {
  width: 14px;
  height: 14px;
  transition: transform 0.3s ease;
}

.mode-opt:hover .icon {
  transform: scale(1.15);
}

.mode-opt.active {
  background: var(--pop-bg);
  color: var(--text);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.mode-opt.active .icon {
  color: var(--primary);
}

/* 颜色网格 */
.palette-grid {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.color-swatch {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  animation: swatchPop 0.3s ease forwards;
  animation-delay: var(--delay);
  opacity: 0;
  transform: scale(0.8);
}

@keyframes swatchPop {
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.swatch-ring {
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 2px solid transparent;
  transition: all 0.25s ease;
}

.color-swatch:hover {
  transform: scale(1.15);
}

.color-swatch:hover .swatch-ring {
  border-color: var(--text);
  opacity: 0.3;
}

.color-swatch.active .swatch-ring {
  border-color: var(--text);
  opacity: 0.6;
}

.color-swatch:active {
  transform: scale(0.95);
}

.check-icon {
  width: 16px;
  height: 16px;
  color: white;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.2));
}

.swatch-purple { background: linear-gradient(135deg, #7c3aed, #a855f7); }
.swatch-cyan { background: linear-gradient(135deg, #06b6d4, #0ea5e9); }
.swatch-emerald { background: linear-gradient(135deg, #10b981, #34d399); }
.swatch-rose { background: linear-gradient(135deg, #f43f5e, #fb7185); }

.check-pop-enter-active {
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.check-pop-leave-active {
  transition: all 0.15s ease;
}

.check-pop-enter-from {
  opacity: 0;
  transform: scale(0) rotate(-45deg);
}

.check-pop-leave-to {
  opacity: 0;
  transform: scale(0);
}
</style>

<!--
  全局样式：必须放在非 scoped 中
  控制 View Transition 的层级和混合模式
-->
<style>
/* 全局样式 - 统一弹出框风格 */
.theme-popover-custom {
  padding: 14px !important;
  border-radius: 16px !important;
  border: 1px solid var(--sloth-card-border) !important;
  background: var(--sloth-card, rgba(255, 255, 255, 0.9)) !important;
  backdrop-filter: blur(16px) !important;
  -webkit-backdrop-filter: blur(16px) !important;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08) !important;
  overflow: hidden !important;
  transform-origin: top right;
}

.theme-popover-custom .el-popover__title {
  display: none !important;
}

/* 暗黑模式增强 */
:global(.dark) .theme-popover-custom {
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.3),
    0 20px 40px -4px rgba(0, 0, 0, 0.5),
    0 0 60px -10px rgba(124, 58, 237, 0.15),
    0 0 0 1px rgba(255, 255, 255, 0.05) inset !important;
}

::view-transition-old(root),
::view-transition-new(root) {
  /* 关闭默认的淡入淡出，只由我们手动控制 clip-path */
  animation: none;
  mix-blend-mode: normal;
}

::view-transition-new(root) {
  /* 确保新视图在最顶层，不会被旧视图遮挡 */
  z-index: 2147483646;
}

/* 兼容深色模式下的层级问题 */
.dark::view-transition-old(root) {
  z-index: 1;
}
.dark::view-transition-new(root) {
  z-index: 2147483646;
}
</style>