<template>
  <NormalToolbar title="居中" @onClick="handleClick">
    <svg class="md-editor-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="3" y1="6" x2="21" y2="6"></line>
      <line x1="6" y1="12" x2="18" y2="12"></line>
      <line x1="3" y1="18" x2="21" y2="18"></line>
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

// insert 由编辑器自动注入到 defToolbars 插槽的组件中
const props = defineProps<{
  insert?: InsertFn
}>()

// 检测是否为 Markdown 图片格式: ![alt](url) 或 ![alt](url)[]() 
const isMdImage = (text: string): boolean => {
  const mdImageRegex = /^!\[.*?\]\([^)]*\)(\[\]\([^)]*\))?$/
  return mdImageRegex.test(text.trim())
}

// 解析 Markdown 图片，提取 alt 和 url
const parseMdImage = (text: string): { alt: string; url: string } | null => {
  const match = text.trim().match(/^!\[(.*?)\]\(([^)]*)\)/)
  if (match) {
    return { alt: match[1] || '', url: match[2] || '' }
  }
  return null
}

// 检测是否为 Markdown 标题格式: # 标题、## 标题 等（支持1-6级）
const isMdHeading = (text: string): boolean => {
  const mdHeadingRegex = /^#{1,6}\s+.+$/
  return mdHeadingRegex.test(text.trim())
}

// 解析 Markdown 标题，提取级别和内容
const parseMdHeading = (text: string): { level: number; content: string } | null => {
  const match = text.trim().match(/^(#{1,6})\s+(.+)$/)
  if (match) {
    return { level: match[1].length, content: match[2] }
  }
  return null
}

const handleClick = () => {
  if (props.insert) {
    props.insert((selectedText: string) => {
      const trimmed = selectedText.trim()
      
      // 检测是否为 Markdown 标题
      if (isMdHeading(trimmed)) {
        const headingInfo = parseMdHeading(trimmed)
        if (headingInfo) {
          // 转换为居中的 HTML 标题标签
          return {
            targetValue: `<h${headingInfo.level} style="text-align: center;">${headingInfo.content}</h${headingInfo.level}>`,
            select: true,
            deviationStart: 0,
            deviationEnd: 0,
          }
        }
      }
      
      // 检测是否为 Markdown 图片
      if (isMdImage(trimmed)) {
        const imgInfo = parseMdImage(trimmed)
        if (imgInfo) {
          // 转换为居中的 HTML img 标签
          const altAttr = imgInfo.alt ? ` alt="${imgInfo.alt}"` : ''
          return {
            targetValue: `<div style="text-align: center;">\n  <img src="${imgInfo.url}"${altAttr} />\n</div>`,
            select: true,
            deviationStart: 0,
            deviationEnd: 0,
          }
        }
      }
      
      // 普通文本居中
      const content = selectedText || '居中内容'
      return {
        targetValue: `<p style="text-align: center;">${content}</p>`,
        select: true,
        deviationStart: 0,
        deviationEnd: 0,
      }
    })
  }
}
</script>
