import type { ICommand } from '@uiw/react-md-editor'
import { cloneElement } from 'react'

/** Clone commands, including submenu entries, without mutating library singletons. */
export function localizeEditorCommand(command: ICommand, labels: Record<string, string>, disabled = false): ICommand {
  const label = command.name ? labels[command.name] : undefined
  const localized: ICommand = {
    ...command,
    ...(label && command.icon && /^heading[1-6]$/.test(command.name || '') ? { icon: cloneElement(command.icon, undefined, label) } : {}),
    ...(command.buttonProps ? {
      buttonProps: {
        ...command.buttonProps,
        ...(label ? { title: label, 'aria-label': label } : {}),
        disabled: disabled || command.buttonProps.disabled,
      },
    } : {}),
  }
  if (Array.isArray(command.children)) return { ...localized, children: command.children.map((child) => localizeEditorCommand(child, labels, disabled)) }
  return localized
}
