'use client'

/**
 * @file content-tag-render.tsx
 * @project SlothVault
 * @module Content Tag Selection
 * @description Adapts stable content-tag colors to editable Ant Design selections.
 * @logic Preserve selection focus, close callbacks, and disabled behavior while sharing reader tag colors.
 * @dependencies antd, tag-colors
 * @index_tags tags,select,editor,keyboard
 * @author holic512
 */

import { Tag, type SelectProps } from 'antd'

import { getContentTagColor } from '@/theme/tag-colors'

export const renderContentTag = (
  { label, value, disabled, closable, onClose }: Parameters<NonNullable<SelectProps['tagRender']>>[0],
  selectionDisabled = false,
) => (
  <Tag
    color={getContentTagColor(String(value))}
    disabled={disabled || selectionDisabled}
    closable={closable && !disabled && !selectionDisabled}
    onClose={onClose}
    onMouseDown={(event) => {
      event.preventDefault()
      event.stopPropagation()
    }}
  >{label}</Tag>
)
