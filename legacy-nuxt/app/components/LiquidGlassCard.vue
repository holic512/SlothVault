<script setup>
/**
 * LiquidGlassCard - 优雅收缩版
 *
 * 修复问题:
 * 1. 修复 width: auto 导致的动画失效和位置跳动。
 * 2. 增加内容与按钮的平滑淡入淡出 (Cross-fade)。
 * 3. 优化交互手感。
 */
import { ref, computed, watch, nextTick } from 'vue'

const props = defineProps({
  borderRadius: { type: [Number, String], default: 24 },
  blur: { type: Number, default: 12 },
  padding: { type: String, default: '24px' }, // 增加默认内边距更好看
  bgOpacity: { type: Number, default: 0.6 },
  collapsible: { type: Boolean, default: false },
  collapsed: { type: Boolean, default: false }
})

const emit = defineEmits(['update:collapsed', 'expand', 'collapse'])

const cardRef = ref(null)
const contentRef = ref(null)
const mousePos = ref({ x: 0.5, y: 0.5 })
const isHovered = ref(false)
const isAnimating = ref(false) // 新增：防止动画过程中重复触发

// 内部状态
const internalCollapsed = ref(props.collapsed)

// 监听外部变化
watch(() => props.collapsed, (newVal) => {
  if (newVal !== internalCollapsed.value) {
    toggleCollapse(newVal) // 使用动画逻辑处理外部变化
  }
})

// 核心逻辑：优雅的尺寸过渡动画（性能优化版）
const toggleCollapse = async (targetState = !internalCollapsed.value) => {
  if (!cardRef.value || isAnimating.value) return

  const el = cardRef.value
  isAnimating.value = true

  // 1. 记录当前尺寸 (起始状态)
  const startWidth = el.offsetWidth
  const startHeight = el.offsetHeight

  // 2. 锁定当前尺寸，防止布局瞬间坍塌
  el.style.width = `${startWidth}px`
  el.style.height = `${startHeight}px`

  // 强制浏览器重绘 (Reflow)，确保上面的 style 生效
  void el.offsetHeight

  // 3. 切换状态逻辑
  internalCollapsed.value = targetState
  emit('update:collapsed', internalCollapsed.value)

  // 4. 下一帧设置目标尺寸
  requestAnimationFrame(() => {
    // 性能优化：只对必要的属性启用过渡，避免 transition: all
    el.style.transition = 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1), height 0.6s cubic-bezier(0.4, 0, 0.2, 1), padding 0.6s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.6s ease'

    if (targetState) {
      // -> 收缩
      el.style.width = '48px'
      el.style.height = '48px'
      el.style.padding = '0' // 收缩时移除 padding
      emit('collapse')
    } else {
      // -> 展开
      // 恢复 padding
      el.style.padding = props.padding

      // 清除宽高限制，让 CSS 接管（width: 100%）
      el.style.width = ''
      el.style.height = ''

      emit('expand')
    }
  })

  // 5. 动画结束后清理内联样式，恢复响应式
  setTimeout(() => {
    isAnimating.value = false
    // 只有在展开状态下才完全清除样式，保持响应式
    // 收缩状态下我们要保持 48px
    if (!targetState) {
      el.style.width = ''
      el.style.height = ''
      el.style.padding = ''
      el.style.transition = '' // 移除 JS 添加的 transition，回归 CSS
    }
  }, 600) // 对应 transition 时间 0.6s
}

const handleMouseMove = (e) => {
  if (!cardRef.value || internalCollapsed.value) return
  const rect = cardRef.value.getBoundingClientRect()
  mousePos.value = {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height
  }
}

const highlightStyle = computed(() => {
  const x = mousePos.value.x * 100
  const y = mousePos.value.y * 100
  const opacity = isHovered.value ? 0.15 : 0.03
  return {
    background: `radial-gradient(circle at ${x}% ${y}%, rgba(255,255,255,${opacity}) 0%, transparent 60%)`,
    transform: isHovered.value ? 'scale(1)' : 'scale(1.1)',
  }
})

const borderRadiusValue = computed(() => {
  // 收缩时强制圆角变小以匹配按钮，展开时用 props
  if (internalCollapsed.value) return '12px'
  return typeof props.borderRadius === 'number' ? `${props.borderRadius}px` : props.borderRadius
})
</script>

<template>
  <div
      ref="cardRef"
      class="liquid-glass-card"
      :class="{
        'liquid-glass-card--hovered': isHovered && !internalCollapsed,
        'liquid-glass-card--collapsed': internalCollapsed,
        'liquid-glass-card--collapsible': collapsible
      }"
      :style="{
        '--lg-padding': padding,
        '--lg-blur': `${blur}px`,
        '--lg-bg-opacity': bgOpacity,
        '--lg-border-radius': borderRadiusValue
      }"
      @mousemove="handleMouseMove"
      @mouseenter="!internalCollapsed && (isHovered = true)"
      @mouseleave="isHovered = false"
  >
    <!-- 1. 收缩按钮层：绝对定位，淡入淡出 -->
    <div class="liquid-glass-card__toggle-layer"
         :class="{ 'show': internalCollapsed }"
         @click.stop="toggleCollapse(!internalCollapsed)">
      <div class="icon-box">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </div>
    </div>

    <!-- 2. 背景与特效层 -->
    <div class="liquid-glass-card__bg-layer">
      <div class="lg-noise"></div>
      <div class="lg-glass"></div>
      <div class="lg-highlight" :style="highlightStyle"></div>
      <div class="lg-border"></div>
    </div>

    <!-- 3. 内容层：使用 Grid 布局处理显隐 -->
    <div ref="contentRef"
         class="liquid-glass-card__content"
         :class="{ 'hide': internalCollapsed }">
      <slot></slot>
    </div>
  </div>
</template>

<style scoped>
.liquid-glass-card {
  position: relative;
  /* 关键：防止 margin collapse 或布局偏移 */
  box-sizing: border-box;
  /* Theme-able shadows/border so dark mode feels softer */
  --lg-shadow-rest: 0 8px 24px rgba(0, 0, 0, 0.06);
  --lg-shadow-hover: 0 12px 32px rgba(0, 0, 0, 0.10);
  --lg-shadow-collapsed: 0 2px 10px rgba(0, 0, 0, 0.08);
  --lg-shadow-collapsed-hover: 0 6px 18px rgba(0, 0, 0, 0.12);
  --lg-border-gradient: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.55) 0%,
    rgba(255, 255, 255, 0.00) 52%,
    rgba(255, 255, 255, 0.45) 100%
  );
  --lg-border-opacity: 1;
  /* 默认宽度，展开时使用 100%，收缩时由 JS 控制 */
  width: 100%;
  min-width: 48px; /* 保证收缩时最小尺寸 */
  min-height: 48px;

  /* 如果要在页面居中显示，建议加上这个，或者由父级 flex 控制 */
  margin: 0 auto;

  border-radius: var(--lg-border-radius);
  /* 性能优化：只对必要的属性启用过渡，使用 GPU 加速 */
  transition: border-radius 0.6s ease, transform 0.3s ease;
  will-change: transform; /* 只提示 transform 变化，减少内存占用 */

  /* 确保收缩时内容不溢出 */
  overflow: hidden;
  padding: var(--lg-padding);
  box-shadow: var(--lg-shadow-rest);
}

.dark .liquid-glass-card {
  /* Dark mode: reduce “hard edge” feeling with softer border + smoother shadow */
  --lg-shadow-rest: 0 10px 28px rgba(0, 0, 0, 0.32);
  --lg-shadow-hover: 0 14px 40px rgba(0, 0, 0, 0.40);
  --lg-shadow-collapsed: 0 4px 14px rgba(0, 0, 0, 0.28);
  --lg-shadow-collapsed-hover: 0 8px 22px rgba(0, 0, 0, 0.34);
  --lg-border-gradient: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.20) 0%,
    rgba(255, 255, 255, 0.02) 55%,
    rgba(255, 255, 255, 0.14) 100%
  );
  --lg-border-opacity: 0.65;
}

/* --- 收缩状态覆盖 --- */
.liquid-glass-card--collapsed {
  /* JS 会覆盖宽高，这里作为 CSS 兜底 */
  padding: 0 !important;
  cursor: pointer;
  /* 性能优化：减少 box-shadow 的模糊半径 */
  box-shadow: var(--lg-shadow-collapsed);
}

.liquid-glass-card--collapsed:hover {
  transform: scale(1.05);
  box-shadow: var(--lg-shadow-collapsed-hover);
}

.liquid-glass-card--hovered {
  transform: translateY(-2px);
  box-shadow: var(--lg-shadow-hover);
}

/* --- 1. Toggle Layer (按钮层) --- */
.liquid-glass-card__toggle-layer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease 0.1s; /* 延迟出现 */
}

.liquid-glass-card__toggle-layer.show {
  opacity: 1;
  pointer-events: auto;
}

.icon-box {
  width: 24px;
  height: 24px;
  color: rgba(0, 0, 0, 0.7);
}
.dark .icon-box { color: rgba(255, 255, 255, 0.8); }

/* --- 2. Content Layer (内容层) --- */
.liquid-glass-card__content {
  position: relative;
  z-index: 5;
  /* 移除 min-width，让内容自然撑开，由父容器控制宽度 */
  opacity: 1;
  transform: translateY(0) scale(1);
  transform-origin: top left;
  transition: opacity 0.2s ease, transform 0.2s ease;
  /* 关键：保持内容占位，直到完全收缩，JS 会处理 padding */
}

.liquid-glass-card__content.hide {
  opacity: 0;
  transform: translateY(-5px) scale(0.98);
  pointer-events: none;
  /*
     技巧：在收缩状态下，我们需要内容完全脱离文档流，
     否则即便 opacity:0，它依然撑着卡片的宽高，导致 JS 设置的 width:48px 无法生效（如果 display 不是 block）
     或者内容溢出。
     由于我们在父级设了 overflow: hidden，且 JS 强设了 height/width，
     这里只需要绝对定位来脱离流即可。
  */
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}

/* --- 3. Background Layers (复用之前的玻璃效果，微调层级) --- */
.liquid-glass-card__bg-layer {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.lg-glass {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, calc(var(--lg-bg-opacity) * 0.8));
  /* 性能优化：减少 backdrop-filter 的模糊半径 */
  backdrop-filter: blur(calc(var(--lg-blur) * 0.75)) saturate(150%);
  /* 锐利边缘 */
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4),
  inset 0 1px 2px 0 rgba(255, 255, 255, 0.6);
  /* 性能优化：使用 GPU 加速 */
  transform: translateZ(0);
  will-change: auto; /* 不预先提示变化，减少内存 */
}
.dark .lg-glass {
  background: rgba(30, 30, 30, calc(var(--lg-bg-opacity) * 0.9));
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    inset 0 1px 2px 0 rgba(255, 255, 255, 0.06);
}

.lg-noise {
  position: absolute;
  inset: 0;
  opacity: 0.04;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
}

.lg-highlight {
  position: absolute;
  inset: 0;
  transition: all 0.4s ease;
  mix-blend-mode: overlay;
}

.lg-border {
  position: absolute;
  inset: 0;
  padding: 1px;
  background: var(--lg-border-gradient);
  opacity: var(--lg-border-opacity);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}
</style>
