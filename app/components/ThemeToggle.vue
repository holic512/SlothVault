<template>
  <div class="theme-manager" ref="containerRef">
    <!-- 1. 触发器按钮 -->
    <button
        class="main-trigger"
        @click="toggleMenu"
        :class="{ 'is-open': isOpen }"
        :aria-label="t('ThemeToggle.aria.openThemeSettings')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>
      </svg>
    </button>

    <!-- 2. 弹出框 -->
    <transition name="pop-fade">
      <div v-show="isOpen" class="theme-popover">

        <div class="section-group">
          <div class="section-title">{{ t('ThemeToggle.section.mode') }}</div>
          <div class="mode-switch">
            <!-- 修改点：传入 $event -->
            <button
                @click="handleThemeChange('light', $event)"
                :class="['mode-opt', { active: theme !== 'dark' }]"
                :title="t('ThemeToggle.mode.light_title')"
            >
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="5"></circle>
                <path
                    d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
              </svg>
              <span>{{ t('ThemeToggle.mode.light') }}</span>
            </button>
            <!-- 修改点：传入 $event -->
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
                v-for="p in palettes"
                :key="p"
                :class="['color-swatch', 'swatch-' + p, { active: palette === p }]"
                @click="setPalette(p)"
                :title="t('ThemeToggle.palette.' + p)"
            >
              <transition name="scale-in">
                <svg v-if="palette === p" class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="3">
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

// 假设这里有 useI18n
const {t, locales, setLocale} = useI18n()

const themeStore = useTheme()
const {theme, palette} = storeToRefs(themeStore)
const {setTheme, setPalette} = themeStore
const palettes = ['purple', 'cyan', 'emerald', 'rose']

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

const handleThemeChange = async (mode, event) => {
  // 1. 如果浏览器不支持，直接切换
  if (!document.startViewTransition) {
    setTheme(mode);
    return;
  }

  // 2. 获取点击位置
  const x = event.clientX;
  const y = event.clientY;

  // 3. 计算最大半径
  const endRadius = Math.hypot(
      Math.max(x, innerWidth - x),
      Math.max(y, innerHeight - y)
  );

  // 4. 启动过渡
  const transition = document.startViewTransition(async () => {
    setTheme(mode);
    await nextTick();
  });

  // 5. 动画定义
  transition.ready.then(() => {
    const clipPath = [
      `circle(0px at ${x}px ${y}px)`,
      `circle(${endRadius}px at ${x}px ${y}px)`,
    ];

    // 关键修改：
    // 不管是变亮还是变暗，我们都只操作 '::view-transition-new(root)'
    // 让“新主题”像墨水一样扩散覆盖在“旧主题”上面。
    document.documentElement.animate(
        {
          clipPath: clipPath,
        },
        {
          duration: 400,
          easing: 'ease-in',
          // 永远指定伪元素为 new(root)，即新视图
          pseudoElement: '::view-transition-new(root)',
        }
    );
  });
};
// 点击外部关闭逻辑
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
/* ... 原有的 scoped 样式保持不变 ... */
/* 容器 & 变量 */
.theme-manager {
  position: relative;
  display: inline-block;
  --pop-bg: var(--sloth-card, rgba(255, 255, 255, 0.8));
  --pop-border: var(--sloth-card-border, rgba(255, 255, 255, 0.2));
  --pop-blur: 12px;
  --primary: var(--sloth-primary, #7c3aed);
  --text: var(--sloth-text, #333);
  --text-dim: rgba(120, 120, 120, 0.8);
}

/* 触发器按钮 */
.main-trigger {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--pop-bg);
  border: 1px solid var(--pop-border);
  color: var(--text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  backdrop-filter: blur(var(--pop-blur));
}

.main-trigger svg {
  width: 24px;
  height: 24px;
  transition: transform 0.5s ease;
}

.main-trigger:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
  color: var(--primary);
}

.main-trigger.is-open {
  background: var(--primary);
  color: white;
  transform: rotate(45deg);
}

/* 弹出面板 */
.theme-popover {
  position: absolute;
  top: 120%;
  right: 0;
  width: 240px;
  background: var(--pop-bg);
  backdrop-filter: blur(var(--pop-blur));
  -webkit-backdrop-filter: blur(var(--pop-blur));
  border: 1px solid var(--pop-border);
  border-radius: 16px;
  padding: 16px;
  box-shadow: 0 10px 40px -10px rgba(0, 0, 0, 0.2);
  z-index: 100;
  transform-origin: top right;
}

/* 区域样式 */
.section-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-dim);
  font-weight: 600;
  margin-bottom: 10px;
}

.divider {
  height: 1px;
  background: var(--pop-border);
  margin: 14px 0;
  opacity: 0.5;
}

/* 明暗切换组件 */
.mode-switch {
  display: flex;
  background: rgba(0, 0, 0, 0.05);
  padding: 4px;
  border-radius: 10px;
  gap: 4px;
}

:global(.dark) .mode-switch {
  background: rgba(255, 255, 255, 0.1);
}

.mode-opt {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s ease;
}

.mode-opt .icon {
  width: 16px;
  height: 16px;
}

.mode-opt.active {
  background: var(--pop-bg);
  color: var(--text);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

/* 颜色网格 */
.palette-grid {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.color-swatch {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s ease;
}

.color-swatch:hover {
  transform: scale(1.1);
}

.color-swatch.active {
  transform: scale(1.1);
  border-color: var(--text);
}

.check-icon {
  width: 16px;
  height: 16px;
  color: white;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
}

/* 颜色定义 */
.swatch-purple {
  background: linear-gradient(135deg, #7c3aed, #c026d3);
}

.swatch-cyan {
  background: linear-gradient(135deg, #06b6d4, #3b82f6);
}

.swatch-emerald {
  background: linear-gradient(135deg, #10b981, #22c55e);
}

.swatch-rose {
  background: linear-gradient(135deg, #f43f5e, #e879f9);
}

/* 动画 */
.pop-fade-enter-active,
.pop-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.pop-fade-enter-from,
.pop-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.95);
}

.scale-in-enter-active {
  transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.scale-in-enter-from {
  transform: scale(0);
}
</style>

<!-- 必须添加全局样式来控制动画行为 -->
<style>
/* 1. 关闭默认的淡入淡出动画 */
::view-transition-old(root),
::view-transition-new(root) {
  animation: none;
  mix-blend-mode: normal;
}

/* 2. 确保新视图在最上层，这样它的扩散才能盖住旧视图 */
::view-transition-new(root) {
  z-index: 2147483646; /* 极大值，确保盖住 old */
}
</style>