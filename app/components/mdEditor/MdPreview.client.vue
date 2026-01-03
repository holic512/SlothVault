<template>
  <MdPreviewLib
    :id="id"
    :model-value="modelValue"
    :theme="actualTheme"
    :preview-theme="previewTheme"
    :code-theme="codeTheme"
    class="md-preview-transparent"
    v-bind="$attrs"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { MdPreview as MdPreviewLib } from 'md-editor-v3'
import 'md-editor-v3/lib/preview.css'
import { useTheme } from '~/stores/useTheme'

interface Props {
  id?: string
  modelValue: string
  theme?: 'light' | 'dark'
  previewTheme?: 'default' | 'github' | 'vuepress' | 'mk-cute' | 'smart-blue' | 'cyanosis'
  codeTheme?: 'atom' | 'a11y' | 'github' | 'gradient' | 'kimbie' | 'paraiso' | 'qtcreator' | 'stackoverflow'
}

const props = withDefaults(defineProps<Props>(), {
  id: 'md-preview',
  previewTheme: 'default',
  codeTheme: 'atom'
})

// 获取全局主题状态
const themeStore = useTheme()
const { theme: globalTheme } = storeToRefs(themeStore)

// 计算实际使用的主题：优先使用 prop，否则使用全局主题
const actualTheme = computed(() => {
  if (props.theme) return props.theme
  return globalTheme.value === 'dark' ? 'dark' : 'light'
})
</script>

<style>
.md-preview-transparent {
  background: transparent !important;
}

.md-preview-transparent .md-editor-preview {
  background: transparent !important;
}

.md-preview-transparent .md-editor-preview-wrapper {
  background: transparent !important;
  padding: 0 !important;
}

/* 移除标题下划线/分割线 */
.md-preview-transparent .md-editor-preview h1,
.md-preview-transparent .md-editor-preview h2,
.md-preview-transparent .md-editor-preview h3,
.md-preview-transparent .md-editor-preview h4,
.md-preview-transparent .md-editor-preview h5,
.md-preview-transparent .md-editor-preview h6 {
  border-bottom: none !important;
  padding-bottom: 0 !important;
}
</style>
