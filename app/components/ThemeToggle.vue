<template>
  <div class="theme-manager" ref="containerRef">
    <!-- 触发器按钮 -->
    <button
        class="main-trigger"
        @click="toggleMenu"
        :class="{ 'is-open': isOpen }"
        :aria-label="t('ThemeToggle.aria.openThemeSettings')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" class="trigger-icon">
        <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>
      </svg>
    </button>

    <!-- 弹出框 -->
    <transition name="pop-slide">
      <div v-show="isOpen" class="theme-popover">

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
    </transition>
  </div>
</template>

<script setup>
import {ref, onMounted, onUnmounted, nextTick} from 'vue'
import {storeToRefs} from 'pinia'
import {useTheme} from '~/stores/useTheme'
import {useLocaleStore} from '~/stores/locale'

const {t, setLocale} = useI18n()

const themeStore = useTheme()
const {theme, palette} = storeToRefs(themeStore)
const {setTheme, setPalette: setStorePalette} = themeStore
const palettes = ['purple', 'cyan', 'emerald', 'rose']

// 颜色配置映射
const paletteColors = {
  purple: {
    gradient: 'linear-gradient(180deg, #7c3aed 0%, #a855f7 100%)',
    shadow: 'rgba(124, 58, 237, 0.5)',
    ripple: 'radial-gradient(circle, rgba(124,58,237,0.9) 0%, rgba(168,85,247,0.8) 50%, transparent 70%)'
  },
  cyan: {
    gradient: 'linear-gradient(180deg, #06b6d4 0%, #0ea5e9 100%)',
    shadow: 'rgba(6, 182, 212, 0.5)',
    ripple: 'radial-gradient(circle, rgba(6,182,212,0.9) 0%, rgba(14,165,233,0.8) 50%, transparent 70%)'
  },
  emerald: {
    gradient: 'linear-gradient(180deg, #10b981 0%, #34d399 100%)',
    shadow: 'rgba(16, 185, 129, 0.5)',
    ripple: 'radial-gradient(circle, rgba(16,185,129,0.9) 0%, rgba(52,211,153,0.8) 50%, transparent 70%)'
  },
  rose: {
    gradient: 'linear-gradient(180deg, #f43f5e 0%, #fb7185 100%)',
    shadow: 'rgba(244, 63, 94, 0.5)',
    ripple: 'radial-gradient(circle, rgba(244,63,94,0.9) 0%, rgba(251,113,133,0.8) 50%, transparent 70%)'
  }
}

const localeStore = useLocaleStore()
const isOpen = ref(false)
const containerRef = ref(null)

const toggleMenu = () => {
  isOpen.value = !isOpen.value
}

const applyLocale = (l) => {
  localeStore.setLocale(l)
  setLocale(l)
}

// 通用水滴动画函数
const playDropletAnimation = async (event, colors, applyChange) => {
  if (!document.startViewTransition) {
    applyChange()
    return
  }

  const btnRect = event.currentTarget.getBoundingClientRect()
  const startX = btnRect.left + btnRect.width / 2
  const startY = btnRect.top + btnRect.height / 2
  
  // 水滴落点位置（屏幕底部 99vh）
  const dropY = window.innerHeight * 0.99
  const endRadius = Math.hypot(
    Math.max(startX, innerWidth - startX),
    Math.max(dropY, innerHeight - dropY)
  ) * 1.5

  // 创建水滴元素
  const droplet = document.createElement('div')
  droplet.className = 'theme-droplet'
  droplet.style.cssText = `
    position: fixed;
    left: ${startX}px;
    top: ${startY}px;
    width: 16px;
    height: 20px;
    background: ${colors.gradient};
    border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
    z-index: 2147483647;
    pointer-events: none;
    filter: drop-shadow(0 2px 8px ${colors.shadow});
    transform: translateX(-50%) translateY(-50%);
  `
  document.body.appendChild(droplet)

  // 水滴下落动画
  const fallDuration = 800
  const fallAnimation = droplet.animate([
    { 
      top: `${startY}px`, 
      transform: 'translateX(-50%) translateY(-50%) scale(1)',
      opacity: 1 
    },
    { 
      top: `${dropY * 0.3}px`, 
      transform: 'translateX(-50%) translateY(-50%) scale(1.1) rotate(5deg)',
      opacity: 1,
      offset: 0.3
    },
    { 
      top: `${dropY * 0.7}px`, 
      transform: 'translateX(-50%) translateY(-50%) scale(1.2) rotate(-3deg)',
      opacity: 1,
      offset: 0.7
    },
    { 
      top: `${dropY}px`, 
      transform: 'translateX(-50%) translateY(-50%) scale(0.8)',
      opacity: 1 
    }
  ], {
    duration: fallDuration,
    easing: 'cubic-bezier(0.55, 0, 1, 0.45)',
    fill: 'forwards'
  })

  // 等待水滴落下
  await fallAnimation.finished

  // 创建涟漪晕染效果
  const ripple = document.createElement('div')
  ripple.className = 'theme-ripple'
  ripple.style.cssText = `
    position: fixed;
    left: ${startX}px;
    top: ${dropY}px;
    width: 0;
    height: 0;
    border-radius: 50%;
    background: ${colors.ripple};
    z-index: 2147483646;
    pointer-events: none;
    transform: translate(-50%, -50%);
  `
  document.body.appendChild(ripple)

  // 涟漪扩散动画
  ripple.animate([
    { width: '0px', height: '0px', opacity: 1 },
    { width: '100px', height: '60px', opacity: 0.8, offset: 0.1 },
    { width: '300px', height: '180px', opacity: 0.6, offset: 0.3 },
    { width: `${endRadius * 2}px`, height: `${endRadius * 2}px`, opacity: 0 }
  ], {
    duration: 600,
    easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    fill: 'forwards'
  })

  // 移除水滴
  droplet.remove()

  // 使用 View Transition 完成切换
  const transition = document.startViewTransition(async () => {
    applyChange()
    await nextTick()
  })

  transition.ready.then(() => {
    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${startX}px ${dropY}px)`,
          `circle(${endRadius}px at ${startX}px ${dropY}px)`
        ]
      },
      {
        duration: 600,
        easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        pseudoElement: '::view-transition-new(root)'
      }
    )
  })

  // 清理涟漪元素
  transition.finished.then(() => {
    ripple.remove()
  })
}

// 主题明暗切换
const handleThemeChange = async (mode, event) => {
  const colors = mode === 'dark' 
    ? {
        gradient: 'linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)',
        shadow: 'rgba(0,0,0,0.5)',
        ripple: 'radial-gradient(circle, rgba(26,26,46,0.9) 0%, rgba(22,33,62,0.8) 50%, transparent 70%)'
      }
    : {
        gradient: 'linear-gradient(180deg, #ffecd2 0%, #fcb69f 100%)',
        shadow: 'rgba(252,182,159,0.5)',
        ripple: 'radial-gradient(circle, rgba(255,236,210,0.9) 0%, rgba(252,182,159,0.8) 50%, transparent 70%)'
      }
  
  await playDropletAnimation(event, colors, () => setTheme(mode))
}

// 颜色切换
const handlePaletteChange = async (p, event) => {
  if (palette.value === p) return
  
  const colors = paletteColors[p]
  await playDropletAnimation(event, colors, () => setStorePalette(p))
}

const handleClickOutside = (event) => {
  if (containerRef.value && !containerRef.value.contains(event.target)) {
    isOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
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

/* 弹出面板 */
.theme-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 220px;
  background: var(--pop-bg);
  backdrop-filter: blur(var(--pop-blur));
  -webkit-backdrop-filter: blur(var(--pop-blur));
  border: 1px solid var(--pop-border);
  border-radius: 16px;
  padding: 14px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  z-index: 100;
  transform-origin: top right;
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

/* 颜色定义 */
.swatch-purple { background: linear-gradient(135deg, #7c3aed, #a855f7); }
.swatch-cyan { background: linear-gradient(135deg, #06b6d4, #0ea5e9); }
.swatch-emerald { background: linear-gradient(135deg, #10b981, #34d399); }
.swatch-rose { background: linear-gradient(135deg, #f43f5e, #fb7185); }

/* 弹出动画 */
.pop-slide-enter-active {
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.pop-slide-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 1, 1);
}

.pop-slide-enter-from {
  opacity: 0;
  transform: translateY(-12px) scale(0.9);
}

.pop-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.95);
}

/* 勾选动画 */
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

<style>
::view-transition-old(root),
::view-transition-new(root) {
  animation: none;
  mix-blend-mode: normal;
}

::view-transition-new(root) {
  z-index: 2147483646;
}

/* 水滴下落时的拖尾效果 */
.theme-droplet::after {
  content: '';
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  width: 8px;
  height: 12px;
  background: inherit;
  border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
  opacity: 0.5;
  filter: blur(2px);
}

/* 涟漪波纹效果 */
.theme-ripple::before,
.theme-ripple::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 2px solid currentColor;
  opacity: 0.3;
  animation: rippleWave 0.8s ease-out forwards;
}

.theme-ripple::after {
  animation-delay: 0.15s;
}

@keyframes rippleWave {
  0% {
    width: 0;
    height: 0;
    opacity: 0.5;
  }
  100% {
    width: 200px;
    height: 120px;
    opacity: 0;
  }
}
</style>
