'use client'

/**
 * @file admin-typography-provider.tsx
 * @project SlothVault
 * @module Administrator Typography Boundary
 * @description Shares compact typography between management pages and their portaled controls.
 * @logic Inherit the application palette and locale, override only typography, and bind contextual feedback to the same scoped theme.
 * @dependencies antd, admin-typography.module.css, SlothVault design tokens
 * @index_tags admin,typography,theme,portal
 * @author holic512
 */
import type { ReactNode } from 'react'

import { App, ConfigProvider, type ThemeConfig } from 'antd'

import styles from '@/styles/modules/admin-typography.module.css'

// Numeric component tokens match the rem scale in tokens.css at the default 16px root.
// The scoped CSS adapter preserves rem sizing for rendered UI and custom portals.
const theme: ThemeConfig = {
  cssVar: { key: 'slothvault-admin' },
  token: {
    fontFamily: 'var(--sv-font-body)',
    fontSize: 13,
    fontSizeSM: 12,
    fontSizeLG: 13,
    fontSizeXL: 16,
    fontSizeHeading1: 'var(--sv-admin-font-page-title)',
    fontSizeHeading2: 'var(--sv-admin-font-section)',
    fontSizeHeading3: 'var(--sv-admin-font-section)',
    fontSizeHeading4: 'var(--sv-admin-font-section)',
    fontSizeHeading5: 'var(--sv-admin-font-section)',
    fontWeightStrong: 600,
    lineHeight: 1.6,
    lineHeightSM: 1.6,
    lineHeightLG: 1.5,
    lineHeightHeading1: 1.4,
    lineHeightHeading2: 1.5,
    lineHeightHeading3: 1.5,
    lineHeightHeading4: 1.5,
    lineHeightHeading5: 1.5,
  },
  components: {
    Button: { fontWeight: 400, contentFontSize: 13, contentFontSizeSM: 13, contentFontSizeLG: 13, contentLineHeight: 1.5, contentLineHeightSM: 1.5, contentLineHeightLG: 1.5 },
    Card: { headerFontSize: 'var(--sv-admin-font-section)', headerFontSizeSM: 'var(--sv-admin-font-section)' },
    Table: { cellFontSize: 13, cellFontSizeMD: 13, cellFontSizeSM: 13 },
    Form: { labelFontSize: 13 },
    Input: { inputFontSize: 13, inputFontSizeSM: 13, inputFontSizeLG: 13 },
    InputNumber: { inputFontSize: 13, inputFontSizeSM: 13, inputFontSizeLG: 13 },
    Modal: { titleFontSize: 'var(--sv-admin-font-dialog-title)', titleLineHeight: 1.5 },
    Drawer: { fontSizeLG: 16, lineHeightLG: 1.5 },
    Tabs: { titleFontSize: 13, titleFontSizeSM: 13, titleFontSizeLG: 13 },
    Menu: { fontSize: 12, groupTitleFontSize: 11, groupTitleLineHeight: 1.5 },
    Statistic: { titleFontSize: 12, contentFontSize: 'var(--sv-admin-font-metric)' },
  },
}

const popup = { classNames: { root: styles.scope } }
const selectionPopup = { classNames: { popup: { root: styles.scope } } }

export function AdminTypographyProvider({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      theme={theme}
      modal={popup}
      drawer={popup}
      popover={popup}
      popconfirm={popup}
      tooltip={popup}
      dropdown={popup}
      message={popup}
      notification={popup}
      select={selectionPopup}
      treeSelect={selectionPopup}
      datePicker={selectionPopup}
      timePicker={selectionPopup}
    >
      <App className={styles.scope}>{children}</App>
    </ConfigProvider>
  )
}
