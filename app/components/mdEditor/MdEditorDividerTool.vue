<template>
  <NormalToolbar title="添加分割线" @onClick="handleClick">
    <svg class="md-editor-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="3" y1="12" x2="21" y2="12"></line>
      <circle cx="8" cy="12" r="1" fill="currentColor"></circle>
      <circle cx="12" cy="12" r="1" fill="currentColor"></circle>
      <circle cx="16" cy="12" r="1" fill="currentColor"></circle>
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

const dividerStyles = [
  { label: '简约线', value: 'simple' },
  { label: '双线', value: 'double' },
  { label: '虚线', value: 'dashed' },
  { label: '渐变线', value: 'gradient' },
  { label: '圆点', value: 'dots' },
  { label: '星号', value: 'stars' },
]

const getDividerHtml = (style: string): string => {
  switch (style) {
    case 'simple':
      return '<hr style="border: none; height: 1px; background: #e5e5e5; margin: 24px 0;" />'
    case 'double':
      return '<div style="margin: 24px 0; border-top: 1px solid #e5e5e5; border-bottom: 1px solid #e5e5e5; height: 4px;"></div>'
    case 'dashed':
      return '<hr style="border: none; border-top: 2px dashed #d1d5db; margin: 24px 0;" />'
    case 'gradient':
      return '<hr style="border: none; height: 2px; background: linear-gradient(to right, transparent, #10b981, transparent); margin: 24px 0;" />'
    case 'dots':
      return '<div style="text-align: center; margin: 24px 0; color: #9ca3af; letter-spacing: 8px;">• • •</div>'
    case 'stars':
      return '<div style="text-align: center; margin: 24px 0; color: #9ca3af; letter-spacing: 12px;">✦ ✦ ✦</div>'
    default:
      return '<hr style="border: none; height: 1px; background: #e5e5e5; margin: 24px 0;" />'
  }
}

const handleClick = () => {
  const overlay = document.createElement('div')
  overlay.className = 'divider-overlay'
  overlay.innerHTML = `
    <div class="divider-dialog">
      <div class="divider-title">选择分割线样式</div>
      <div class="divider-options"></div>
      <div class="divider-actions">
        <button class="divider-btn divider-cancel">取消</button>
      </div>
    </div>
  `

  const optionsContainer = overlay.querySelector('.divider-options')!
  dividerStyles.forEach(style => {
    const btn = document.createElement('button')
    btn.className = 'divider-option-btn'
    btn.innerHTML = `
      <span class="divider-option-label">${style.label}</span>
      <div class="divider-option-preview divider-preview-${style.value}"></div>
    `
    btn.onclick = () => {
      insertDivider(style.value)
      document.body.removeChild(overlay)
    }
    optionsContainer.appendChild(btn)
  })

  const cancelBtn = overlay.querySelector('.divider-cancel')!
  cancelBtn.addEventListener('click', () => {
    document.body.removeChild(overlay)
  })

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      document.body.removeChild(overlay)
    }
  })

  document.body.appendChild(overlay)
}

const insertDivider = (style: string) => {
  if (props.insert) {
    props.insert(() => ({
      targetValue: `\n${getDividerHtml(style)}\n`,
      select: false,
      deviationStart: 0,
      deviationEnd: 0,
    }))
  }
}
</script>

<style>
.divider-overlay {
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

.divider-dialog {
  background: var(--sloth-card, #fff);
  border-radius: 12px;
  padding: 20px;
  min-width: 320px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.divider-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  color: var(--sloth-text, #333);
}

.divider-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.divider-option-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--sloth-card-border, #e5e5e5);
  border-radius: 8px;
  background: var(--sloth-bg, #f5f5f5);
  color: var(--sloth-text, #333);
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.divider-option-btn:hover {
  border-color: var(--sloth-primary, #10b981);
  background: var(--sloth-primary-dim, #ecfdf5);
}

.divider-option-label {
  font-size: 13px;
  min-width: 60px;
}

.divider-option-preview {
  flex: 1;
  height: 20px;
  display: flex;
  align-items: center;
}

.divider-preview-simple::after {
  content: '';
  display: block;
  width: 100%;
  height: 1px;
  background: #9ca3af;
}

.divider-preview-double::after {
  content: '';
  display: block;
  width: 100%;
  height: 4px;
  border-top: 1px solid #9ca3af;
  border-bottom: 1px solid #9ca3af;
}

.divider-preview-dashed::after {
  content: '';
  display: block;
  width: 100%;
  border-top: 2px dashed #9ca3af;
}

.divider-preview-gradient::after {
  content: '';
  display: block;
  width: 100%;
  height: 2px;
  background: linear-gradient(to right, transparent, #10b981, transparent);
}

.divider-preview-dots::after {
  content: '• • •';
  color: #9ca3af;
  letter-spacing: 4px;
  font-size: 12px;
}

.divider-preview-stars::after {
  content: '✦ ✦ ✦';
  color: #9ca3af;
  letter-spacing: 6px;
  font-size: 10px;
}

.divider-actions {
  display: flex;
  justify-content: flex-end;
}

.divider-btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.divider-cancel {
  background: var(--sloth-bg, #f5f5f5);
  border: 1px solid var(--sloth-card-border, #e5e5e5);
  color: var(--sloth-text, #333);
}

.divider-cancel:hover {
  background: var(--sloth-bg-hover, #eee);
}
</style>
