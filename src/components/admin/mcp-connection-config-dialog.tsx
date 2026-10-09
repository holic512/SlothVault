'use client'

/**
 * @file mcp-connection-config-dialog.tsx
 * @project SlothVault
 * @module One-time Native MCP Configuration Dialog
 * @description Displays direct Codex and Claude Code configurations and safe placeholder-only connection guidance.
 * @logic Keep configuration values in controlled read-only fields, copy only after a user click, offer manual selection on failure, and remove sensitive children immediately when closed.
 * @dependencies Ant Design, next-intl, mcp-connection-config
 * @index_tags admin,mcp,configuration,clipboard,one-time,accessibility
 * @author holic512
 */
import { useEffect, useId, useRef, useState } from 'react'

import { Alert, Button, Input, Modal, Typography } from 'antd'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import { Check, Copy, TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { McpConnectionConfig } from '@/lib/mcp-connection-config'
import styles from '@/styles/modules/mcp-connection-config.module.css'

function ConfigurationBlock({ section, value }: { section: 'codex' | 'claude'; value: string }) {
  const t = useTranslations('AdminMM.mcpKeys')
  const id = useId()
  const field = useRef<TextAreaRef>(null)
  const generation = useRef(0)
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null)

  useEffect(() => () => { generation.current += 1 }, [])

  const copy = () => {
    const current = ++generation.current
    const failed = () => {
      if (current !== generation.current) return
      setFeedback('error')
      field.current?.focus({ cursor: 'all' })
    }
    try {
      void navigator.clipboard.writeText(value).then(() => {
        if (current === generation.current) setFeedback('success')
      }, failed)
    } catch {
      failed()
    }
  }

  return (
    <section className={styles.block} aria-labelledby={id}>
      <div className={styles['block-header']}>
        <strong id={id}>{section === 'codex' ? 'Codex' : 'Claude Code'}</strong>
        <Button className={styles.copy} size="small" icon={<Copy size={14} />} aria-label={t(`dialog.${section}Copy`)} onClick={copy}>
          {t('actions.copy')}
        </Button>
      </div>
      <Typography.Paragraph className={styles.hint}>
        {t(`dialog.${section}Hint`)}
      </Typography.Paragraph>
      <Input.TextArea
        ref={field}
        className={styles.code}
        aria-label={t(`dialog.${section}Value`)}
        autoComplete="off"
        spellCheck={false}
        readOnly
        rows={section === 'codex' ? 7 : 3}
        value={value}
      />
      <div className={styles.feedback} role={feedback === 'error' ? 'alert' : 'status'} aria-live={feedback === 'error' ? 'assertive' : 'polite'}>
        {feedback ? <>
          {feedback === 'success' ? <Check size={15} aria-hidden="true" /> : <TriangleAlert size={15} aria-hidden="true" />}
          <span>{t(feedback === 'success' ? 'messages.copied' : 'messages.copyFailed')}</span>
        </> : null}
      </div>
    </section>
  )
}

export function McpConnectionConfigDialog({ configuration, template = false, onClose, onCreateKey, restoreFocus }: {
  configuration: McpConnectionConfig | null
  template?: boolean
  onClose: () => void
  onCreateKey?: () => void
  restoreFocus?: () => void
}) {
  const t = useTranslations('AdminMM.mcpKeys')
  // Unmount immediately: a Modal closing animation can retain its previous children.
  if (!configuration) return null
  const close = () => {
    onClose()
    queueMicrotask(() => restoreFocus?.())
  }

  return (
    <Modal
      className={styles.dialog}
      open
      title={t(template ? 'dialog.guideTitle' : 'dialog.revealTitle')}
      closable={{ 'aria-label': t('actions.close') }}
      width="min(760px, calc(100vw - 32px))"
      centered
      destroyOnHidden
      mask={{ closable: false }}
      keyboard
      onCancel={close}
      focusable={{ focusTriggerAfterClose: false }}
      footer={template ? (
        <div className={styles['guide-footer']}>
          <Button onClick={close}>{t('actions.close')}</Button>
          <Button className={styles.confirm} type="primary" onClick={onCreateKey}>{t('actions.createNew')}</Button>
        </div>
      ) : <Button className={styles.confirm} block type="primary" onClick={close}>{t('actions.confirmSaved')}</Button>}
    >
      <>
        <Alert className={styles.notice} showIcon type={template ? 'info' : 'warning'} title={t(template ? 'dialog.guideWarning' : 'dialog.revealWarning')} />
        <Typography.Paragraph className={styles.description}>
          {t(template ? 'dialog.guideDescription' : 'dialog.revealDescription')}
        </Typography.Paragraph>
        <ConfigurationBlock section="codex" value={configuration.codexToml} />
        <ConfigurationBlock section="claude" value={configuration.claudeCommand} />
      </>
    </Modal>
  )
}
