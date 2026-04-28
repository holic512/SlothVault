<template>
  <MdEditor
    v-model="model"
    :language="language"
    :theme="actualTheme"
    :preview-theme="previewTheme"
    :code-theme="codeTheme"
    :toolbars="toolbars"
    @on-upload-img="onUploadImg"
    v-bind="$attrs"
  >
    <template #defToolbars>
      <MdEditorCenterTool />
      <MdEditorSpacerTool />
      <MdEditorDividerTool />
    </template>
  </MdEditor>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { MdEditor } from 'md-editor-v3'
import type { ToolbarNames } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { useTheme } from '~/stores/useTheme'

interface Props {
  language?: string
  theme?: 'light' | 'dark'
  previewTheme?: 'default' | 'github' | 'vuepress' | 'mk-cute' | 'smart-blue' | 'cyanosis'
  codeTheme?: 'atom' | 'a11y' | 'github' | 'gradient' | 'kimbie' | 'paraiso' | 'qtcreator' | 'stackoverflow'
}

const props = withDefaults(defineProps<Props>(), {
  language: 'zh-CN',
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

const model = defineModel<string>({ default: '' })

// 工具栏配置：添加自定义居中按钮（索引 0）
const toolbars: ToolbarNames[] = [
  'bold',
  'underline',
  'italic',
  '-',
  'title',
  'strikeThrough',
  'sub',
  'sup',
  'quote',
  'unorderedList',
  'orderedList',
  'task',
  '-',
  'codeRow',
  'code',
  'link',
  'image',
  'table',
  'mermaid',
  'katex',
  '-',
  0, // 自定义居中按钮
  1, // 自定义间距按钮
  2, // 自定义分割线按钮
  '-',
  'revoke',
  'next',
  'save',
  '=',
  'pageFullscreen',
  'fullscreen',
  'preview',
  'previewOnly',
  'htmlPreview',
  'catalog',
]

const emit = defineEmits<{
  uploadImg: [files: File[], callback: (urls: string[]) => void]
}>()

const onUploadImg = async (files: File[], callback: (urls: string[]) => void) => {
  emit('uploadImg', files, callback)
}
</script>
