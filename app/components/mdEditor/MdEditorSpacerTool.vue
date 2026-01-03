<template>
  <NormalToolbar title="添加间距" @onClick="handleClick">
    <svg class="md-editor-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="12" y1="3" x2="12" y2="9"></line>
      <polyline points="8 6 12 3 16 6"></polyline>
      <line x1="12" y1="21" x2="12" y2="15"></line>
      <polyline points="8 18 12 21 16 18"></polyline>
      <line x1="3" y1="12" x2="21" y2="12"></line>
    </svg>
  </NormalToolbar>
</template>

<script setup lang="ts">
import { NormalToolbar } from 'md-editor-v3'

type InsertFn = (generator: (selectedText: string) => {
  targetValue: string
  select?: boolean
  deviationStart?: number
  deviationEnd?: number
}) => void

const props = defineProps<{
  insert?: InsertFn
}>()

const presetHeights = [
  { label: '小 (16px)', value: 16 },
  { label: '中 (32px)', value: 32 },
  { label: '大 (48px)', value: 48 },
  { label: '超大 (64px)', value: 64 },
]

const handleClick = () => {
  // 创建弹出选择框
  const overlay = document.createElement('div')
  overlay.className = 'spacer-overlay'
  overlay.innerHTML = `
    <div class="spacer-dialog">
      <div class="spacer-title">选择间距高度</div>
      <div class="spacer-presets"></div>
      <div class="spacer-custom">
        <input type="number" class="spacer-input" placeholder="自定义高度" min="1" max="500" />
        <span class="spacer-unit">px</span>
      </div>
      <div class="spacer-actions">
        <button class="spacer-btn spacer-cancel">取消</button>
        <button class="spacer-btn spacer-confirm">确定</button>
      </div>
    </div>
  `

  // 添加预设按钮
  const presetsContainer = overlay.querySelector('.spacer-presets')!
  presetHeights.forEach(preset => {
    const btn = document.createElement('button')
    btn.className = 'spacer-preset-btn'
    btn.textContent = preset.label
    btn.onclick = () => {
      insertSpacer(preset.value)
      document.body.removeChild(overlay)
    }
    presetsContainer.appendChild(btn)
  })

  // 自定义输入
  const input = overlay.querySelector('.spacer-input') as HTMLInputElement
  const confirmBtn = overlay.querySelector('.spacer-confirm')!
  const cancelBtn = overlay.querySelector('.spacer-cancel')!

  confirmBtn.addEventListener('click', () => {
    const value = parseInt(input.value)
    if (value > 0) {
      insertSpacer(value)
    }
    document.body.removeChild(overlay)
  })

  cancelBtn.addEventListener('click', () => {
    document.body.removeChild(overlay)
  })

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      document.body.removeChild(overlay)
    }
  })

  // 回车确认
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const value = parseInt(input.value)
      if (value > 0) {
        insertSpacer(value)
      }
      document.body.removeChild(overlay)
    }
  })

  document.body.appendChild(overlay)
  input.focus()
}

const insertSpacer = (height: number) => {
  if (props.insert) {
    props.insert(() => ({
      targetValue: `<div style="height: ${height}px;"></div>`,
      select: false,
      deviationStart: 0,
      deviationEnd: 0,
    }))
  }
}
</script>

<style>
.spacer-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.spacer-dialog {
  background: var(--sloth-card, #fff);
  border-radius: 12px;
  padding: 20px;
  min-width: 280px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.spacer-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  color: var(--sloth-text, #333);
}

.spacer-presets {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 16px;
}

.spacer-preset-btn {
  padding: 10px 12px;
  border: 1px solid var(--sloth-card-border, #e5e5e5);
  border-radius: 8px;
  background: var(--sloth-bg, #f5f5f5);
  color: var(--sloth-text, #333);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.spacer-preset-btn:hover {
  border-color: var(--sloth-primary, #10b981);
  color: var(--sloth-primary, #10b981);
  background: var(--sloth-primary-dim, #ecfdf5);
}

.spacer-custom {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.spacer-input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid var(--sloth-card-border, #e5e5e5);
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  background: var(--sloth-bg, #fff);
  color: var(--sloth-text, #333);
}

.spacer-input:focus {
  border-color: var(--sloth-primary, #10b981);
}

.spacer-unit {
  color: var(--sloth-text-subtle, #999);
  font-size: 14px;
}

.spacer-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.spacer-btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.spacer-cancel {
  background: var(--sloth-bg, #f5f5f5);
  border: 1px solid var(--sloth-card-border, #e5e5e5);
  color: var(--sloth-text, #333);
}

.spacer-cancel:hover {
  background: var(--sloth-bg-hover, #eee);
}

.spacer-confirm {
  background: var(--sloth-primary, #10b981);
  border: none;
  color: #fff;
}

.spacer-confirm:hover {
  opacity: 0.9;
}
</style>
