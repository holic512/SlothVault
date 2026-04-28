/**
 * 统一消息提示 Composable
 *
 * 封装 ElMessage，默认启用关闭按钮
 */

import { ElMessage, type MessageOptions } from 'element-plus'

type MessageType = 'success' | 'warning' | 'info' | 'error'

interface MessageConfig extends Partial<MessageOptions> {
  showClose?: boolean
}

const defaultConfig: MessageConfig = {
  showClose: true,
}

function createMessage(type: MessageType) {
  return (message: string, options?: MessageConfig) => {
    return ElMessage({
      type,
      message,
      ...defaultConfig,
      ...options,
    })
  }
}

export const message = {
  success: createMessage('success'),
  warning: createMessage('warning'),
  info: createMessage('info'),
  error: createMessage('error'),
}

/**
 * 消息提示 Composable
 */
export function useMessage() {
  return message
}
