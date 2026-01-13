<script setup>
/**
 * LiquidGlassCard - 液态玻璃效果卡片组件 (优化版)
 *
 * 优化点:
 * 1. 降低触摸光效 (Subtle Touch Lighting)
 * 2. 增强边缘玻璃质感 (Crisp Glass Edges)
 */
import { ref, computed } from 'vue'

const props = defineProps({
  borderRadius: {
    type: [Number, String],
    default: 24
  },
  blur: {
    type: Number,
    default: 12
  },
  padding: {
    type: String,
    default: '12px 24px'
  },
  hoverEffect: {
    type: Boolean,
    default: true
  },
  bgOpacity: {
    type: Number,
    default: 0.6
  }
})

const cardRef = ref(null)
const mousePos = ref({ x: 0.5, y: 0.5 })
const isHovered = ref(false)

const handleMouseMove = (e) => {
  if (!cardRef.value) return
  const rect = cardRef.value.getBoundingClientRect()
  mousePos.value = {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height
  }
}

const handleMouseEnter = () => {
  isHovered.value = true
}

const handleMouseLeave = () => {
  isHovered.value = false
  mousePos.value = { x: 0.5, y: 0.5 }
}

// [修改] 高光样式：进一步降低不透明度，使光效更柔和
const highlightStyle = computed(() => {
  const x = mousePos.value.x * 100
  const y = mousePos.value.y * 100

  // 透明度再次降低：悬停 0.18 / 默认 0.03
  const opacity = isHovered.value ? 0.18 : 0.03

  return {
    background: `radial-gradient(circle at ${x}% ${y}%,
      rgba(255, 255, 255, ${opacity}) 0%,
      rgba(255, 255, 255, ${opacity * 0.4}) 20%,
      transparent 50%)`,
    transform: isHovered.value ? 'scale(1)' : 'scale(1.1)',
    // 改为 soft-light 柔光模式，避免高光过曝，更像自然反光
    mixBlendMode: 'soft-light'
  }
})

// [修改] 边缘辉光：进一步减弱，更加含蓄
const edgeGlowStyle = computed(() => {
  if (!isHovered.value) return { opacity: 0 }
  const x = mousePos.value.x * 100
  const y = mousePos.value.y * 100

  return {
    opacity: 0.25, // 进一步降低整体不透明度
    background: `radial-gradient(circle at ${x}% ${y}%,
      rgba(255, 255, 255, 0.15) 0%,
      transparent 40%)`, // 范围更小，颜色更淡
    filter: 'blur(18px)' // 模糊度增加，光更加弥散
  }
})

const borderRadiusValue = computed(() => {
  return typeof props.borderRadius === 'number'
      ? `${props.borderRadius}px`
      : props.borderRadius
})
</script>

<template>
  <div
      ref="cardRef"
      class="liquid-glass-card"
      :class="{ 'liquid-glass-card--hovered': isHovered && hoverEffect }"
      :style="{
      '--lg-border-radius': borderRadiusValue,
      '--lg-blur': `${blur}px`,
      '--lg-padding': padding,
      '--lg-bg-opacity': bgOpacity
    }"
      @mousemove="handleMouseMove"
      @mouseenter="handleMouseEnter"
      @mouseleave="handleMouseLeave"
  >
    <div class="liquid-glass-card__noise"></div>
    <div class="liquid-glass-card__bg"></div>
    <div class="liquid-glass-card__highlight" :style="highlightStyle"></div>
    <div class="liquid-glass-card__edge-glow" :style="edgeGlowStyle"></div>
    <!-- 边框层放在最上层以确保锐度 -->
    <div class="liquid-glass-card__border"></div>
    <div class="liquid-glass-card__content">
      <slot></slot>
    </div>
  </div>
</template>

<style scoped>
.liquid-glass-card {
  position: relative;
  border-radius: var(--lg-border-radius);
  transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.4s ease;
  transform: translate3d(0,0,0);
}

.liquid-glass-card--hovered {
  transform: translateY(-2px) scale(1.002); /* 进一步减小位移和缩放 */
  /* 阴影更加收敛 */
  box-shadow:
      0 6px 20px rgba(0, 0, 0, 0.12),
      0 2px 6px rgba(0, 0, 0, 0.04);
}

.liquid-glass-card__noise {
  position: absolute;
  inset: 0;
  border-radius: var(--lg-border-radius);
  opacity: 0.05; /* 降低噪点，使玻璃更纯净 */
  pointer-events: none;
  z-index: 2;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
}

/* [修改] 背景层：增强边缘的厚度感 */
.liquid-glass-card__bg {
  position: absolute;
  inset: 0;
  border-radius: var(--lg-border-radius);
  background: rgba(255, 255, 255, calc(var(--lg-bg-opacity) * 0.6));
  backdrop-filter: blur(var(--lg-blur)) saturate(180%);
  -webkit-backdrop-filter: blur(var(--lg-blur)) saturate(180%);

  /*
     关键修改：
     第一行 inset: 增加了一条锐利的 1px 白色内描边，这能极大地增加"玻璃切面"的感觉
  */
  box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.3),
      inset 0 1px 2px 0 rgba(255, 255, 255, 0.6),
      inset 0 -15px 30px rgba(255, 255, 255, 0.15); /* 底部反光减弱，更通透 */
  z-index: 0;
}

.dark .liquid-glass-card__bg {
  background: rgba(20, 20, 20, calc(var(--lg-bg-opacity) * 0.8));
  box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.1),
      inset 0 1px 30px rgba(255, 255, 255, 0.05),
      inset 0 -20px 40px rgba(0, 0, 0, 0.6);
}

.liquid-glass-card__highlight {
  position: absolute;
  inset: 0;
  border-radius: var(--lg-border-radius);
  z-index: 3;
  pointer-events: none;
  transition: all 0.3s ease; /* 增加过渡时间，光效移动更平滑 */
}

.liquid-glass-card__edge-glow {
  position: absolute;
  inset: 0;
  border-radius: var(--lg-border-radius);
  z-index: 1;
  pointer-events: none;
  transition: opacity 0.3s ease;
}

/* [修改] 边框层：提高硬度，模拟物理反光 */
.liquid-glass-card__border {
  position: absolute;
  inset: 0;
  border-radius: var(--lg-border-radius);
  padding: 1.5px;
  /*
     关键修改：
     对比度更高的线性渐变。
     左上角(0%)和右下角(100%)非常亮(0.9)，中间部分(50%)完全透明。
     这模拟了光线打在玻璃棱角上的高光点。
  */
  background: linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.9) 0%,
      rgba(255, 255, 255, 0.2) 20%,
      rgba(255, 255, 255, 0.0) 50%,
      rgba(255, 255, 255, 0.2) 80%,
      rgba(255, 255, 255, 0.8) 100%
  );
  -webkit-mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  z-index: 4;
  pointer-events: none;
  opacity: 1; /* 保持高不透明度以突出边框质感 */
}

.dark .liquid-glass-card__border {
  background: linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.6) 0%,
      rgba(255, 255, 255, 0.05) 30%,
      rgba(255, 255, 255, 0.0) 50%,
      rgba(255, 255, 255, 0.05) 70%,
      rgba(255, 255, 255, 0.4) 100%
  );
}

.liquid-glass-card__content {
  position: relative;
  z-index: 5;
  padding: var(--lg-padding);
}
</style>