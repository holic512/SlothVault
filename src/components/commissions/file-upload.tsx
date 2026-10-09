'use client'
/**
 * @file file-upload.tsx
 * @project SlothVault
 * @module Private Commission Upload Interaction
 * @description Uploads a raw file with measured progress and an explicit retry after failure.
 * @logic Keep draft artifacts private, preserve the upload idempotency key across retries, and send one bounded stream per file.
 * @dependencies browser XMLHttpRequest, Ant Design, commission HTTP API
 * @index_tags commissions,files,uploads,progress
 * @author holic512
 */
import { useRef, useState } from 'react'
import { Alert, App, Button, Progress, Select, Space } from 'antd'
export function CommissionFileUpload({ base, admin, onUploaded }: { base: string; admin: boolean; onUploaded: () => void }) {
  const { message } = App.useApp(), input = useRef<HTMLInputElement>(null)
  const [purpose, setPurpose] = useState(admin ? 'DELIVERY' : 'REQUIREMENT'), [progress, setProgress] = useState<number | null>(null), [failed, setFailed] = useState(false)
  const pending = useRef<{ file: File; commandId: string; purpose: string; shared: boolean } | null>(null)
  const upload = () => {
    const item = pending.current
    if (!item) return
    const limit = item.purpose === 'PAYMENT' ? 10 * 1024 * 1024 : 100 * 1024 * 1024
    if (item.file.size > limit) { message.error(`当前文件上限为 ${limit / 1024 / 1024} MiB，超大成果请补充外部链接`); return }
    setProgress(0); setFailed(false)
    const xhr = new XMLHttpRequest(), query = new URLSearchParams({ name: item.file.name, purpose: item.purpose, shared: String(item.shared), commandId: item.commandId })
    xhr.open('POST', `${base}/files?${query}`); xhr.setRequestHeader('Content-Type', 'application/octet-stream'); xhr.withCredentials = true
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100)) }
    xhr.onerror = () => { setFailed(true); setProgress(null) }
    xhr.onload = () => { try { const body = JSON.parse(xhr.responseText); if (xhr.status < 200 || xhr.status >= 300 || body.code !== 0) throw new Error(body.message || '上传失败'); setProgress(null); pending.current = null; message.success('已保存附件草稿，请关联到记录并正式提交'); onUploaded() } catch (error) { message.error(error instanceof Error ? error.message : '上传失败'); setFailed(true); setProgress(null) } }
    xhr.send(item.file)
  }
  return <div className="commission-upload"><Space wrap>
    <Select value={purpose} disabled={progress !== null} onChange={setPurpose} options={[{ value: 'REQUIREMENT', label: '需求资料' }, { value: 'CONTRACT', label: '合同细则或确认依据' }, { value: 'PAYMENT', label: '付款凭证' }, { value: 'TEST', label: '测试资料' }, ...(admin ? [{ value: 'DELIVERY', label: '交付成果' }] : [])]} />
    <input ref={input} type="file" hidden accept=".zip,.pdf,.txt,.md,.json,.docx,.xlsx,.pptx,.jpg,.jpeg,.png,.gif,.webp,.mp4,.webm" onChange={(event) => { const file = event.target.files?.[0]; if (file) { pending.current = { file, commandId: crypto.randomUUID(), purpose, shared: false }; upload() } event.target.value = '' }} />
    <Button disabled={progress !== null} loading={progress !== null} onClick={() => input.current?.click()}>选择文件并上传</Button>
    {failed ? <Button onClick={upload}>重新上传同一文件</Button> : null}
  </Space>{progress !== null ? <Progress percent={progress} status="active" /> : null}<Alert type="info" title="上传后仅自己可见，关联记录并确认提交后向委托双方开放" description="源码和文档支持 100 MiB，付款凭证支持 10 MiB。" showIcon /></div>
}
