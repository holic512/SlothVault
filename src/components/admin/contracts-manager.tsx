'use client'

/**
 * @file contracts-manager.tsx
 * @project SlothVault
 * @module Contract Administration
 * @description Provides the administrator workspace for drafting, issuing, inspecting, and anchoring one-to-one Web2 contracts.
 * @logic Keep editable drafts separate from frozen snapshots, let administrators inspect the exact user response timeline, and route a signed contract through the existing wallet transaction ceremony only after its Web2 signature succeeds.
 * @dependencies React Query, Ant Design, Solana Wallet Adapter, MarkdownView, contract APIs
 * @index_tags admin,contracts,drafts,web2-signature,solana,evidence,attachments
 * @author holic512
 */
import { useMemo, useState } from 'react'

import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Alert, Button, Card, Descriptions, Drawer, Form, Input, Select, Space, Table, Tag, Typography, Upload } from 'antd'
import { BadgeCheck, FileCheck2, FilePenLine, FileSignature, Link2, Plus, RefreshCw, Send, ShieldCheck, UploadCloud, UserRound, XCircle } from 'lucide-react'

import { AdminPage, AdminPageActions, AdminTablePanel, AdminToolbar } from '@/components/admin/admin-page'
import { signEvidenceTransaction } from '@/components/admin/evidence-transaction'
import { MarkdownView } from '@/components/markdown/markdown-view'
import { apiFetch } from '@/lib/api-client'
import contractStyles from '@/styles/modules/contracts.module.css'

type ContractCredential = {
  id: string
  network: 'mainnet' | 'devnet'
  signerAddress: string
  transactionSignature: string | null
  status: number
  finalizedAt: string | null
  attempts: Array<{ id: string; status: number; failureMessage: string | null }>
}

type Contract = {
  id: string
  contractId: string
  title: string
  body: string
  bodyHash: string
  contractHash: string | null
  attachment: { id: string; originalName: string; fileSize: string } | null
  status: number
  issuedAt: string | null
  signedAt: string | null
  signedAudit: { sessionId: string | null; ip: string | null; userAgent: string | null } | null
  declinedAt: string | null
  declineReason: string | null
  cancelledAt: string | null
  issuer: { id: string; username: string; displayName: string | null }
  subject: { id: string; username: string; displayName: string | null }
  createdAt: string
  credentials: ContractCredential[]
  adminAudit?: Array<{
    id: string
    action: string
    createdAt: string
    actor: { username: string; displayName: string | null }
  }>
}

type ContractList = { list: Contract[]; total: number; page: number; pageSize: number }
type UserRow = { id: string; username: string; displayName: string | null; role: string; status: number }
type Prepared = {
  credentialId: string
  attemptId: string
  transactionBase64: string
  expiresAt: number
  feeLamports: number
  balanceLamports: number
  memo: string
  signerAddress: string
  title: string
  contractId: string
  contractHash: string
  network: 'mainnet' | 'devnet'
}

const STATUS: Record<number, { label: string; color: string }> = {
  [-2]: { label: '已取消', color: 'default' },
  [-1]: { label: '已拒签', color: 'error' },
  0: { label: '草稿', color: 'default' },
  1: { label: '待签约', color: 'processing' },
  2: { label: '已签约', color: 'success' },
}

const CREDENTIAL_STATUS: Record<number, { label: string; color: string }> = {
  [-1]: { label: '失败', color: 'error' },
  0: { label: '待钱包签名', color: 'default' },
  1: { label: '链上确认中', color: 'processing' },
  2: { label: '已上链', color: 'success' },
}

const ADMIN_AUDIT_ACTION: Record<string, string> = {
  DRAFT_CREATED: '创建草稿',
  DRAFT_UPDATED: '更新草稿',
  ISSUED: '发起并冻结合同',
  CANCELLED: '取消合同',
  EVIDENCE_PREPARED: '生成待签链上交易',
  EVIDENCE_SUBMITTED: '提交链上交易',
  EVIDENCE_RECONCILED: '核验链上状态',
  EVIDENCE_ATTEMPT_CANCELLED: '取消钱包签名请求',
}

function contractStatus(status: number) {
  const entry = STATUS[status] || { label: '未知', color: 'default' }
  return <Tag color={entry.color}>{entry.label}</Tag>
}

function compact(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

export function ContractsManager() {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const { publicKey, signTransaction } = useWallet()
  const { connection } = useConnection()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<number | undefined>()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Contract | null>(null)
  const [detail, setDetail] = useState<Contract | null>(null)
  const [evidenceTarget, setEvidenceTarget] = useState<Contract | null>(null)
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [attachment, setAttachment] = useState<Contract['attachment']>(null)
  const [form] = Form.useForm<{ subjectUserId: number; title: string; body: string }>()
  const [evidenceForm] = Form.useForm<{ network: 'mainnet' | 'devnet' }>()

  const contracts = useQuery({
    queryKey: ['admin-contracts', page, pageSize, keyword, status],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (keyword.trim()) params.set('keyword', keyword.trim())
      if (status !== undefined) params.set('status', String(status))
      return apiFetch<ContractList>(`/api/admin/contracts?${params}`)
    },
  })
  const users = useQuery({
    queryKey: ['contract-subject-users'],
    queryFn: () => apiFetch<{ list: UserRow[] }>('/api/admin/mm/users?page=1&pageSize=100'),
  })
  const networks = useQuery({
    queryKey: ['contract-evidence-networks'],
    queryFn: () => apiFetch<{ networks: Array<{ network: 'mainnet' | 'devnet'; enabled: boolean }> }>('/api/admin/contracts/evidence/networks'),
  })
  const subjectOptions = useMemo(
    () => (users.data?.list || []).filter((user) => user.role === 'USER' && user.status === 1).map((user) => ({
      value: Number(user.id),
      label: `${user.displayName || user.username} · @${user.username}`,
    })),
    [users.data],
  )
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-contracts'] })

  const save = useMutation({
    mutationFn: (values: { subjectUserId: number; title: string; body: string }) => {
      const payload = { ...values, attachmentFileId: attachment ? Number(attachment.id) : null }
      return editing
        ? apiFetch<Contract>(`/api/admin/contracts/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        : apiFetch<Contract>('/api/admin/contracts', { method: 'POST', body: JSON.stringify(payload) })
    },
    onSuccess: async () => {
      message.success(editing ? '合同草稿已保存' : '合同草稿已创建')
      setEditorOpen(false)
      setEditing(null)
      setAttachment(null)
      form.resetFields()
      await refresh()
    },
    onError: (error) => message.error(error.message),
  })
  const issue = useMutation({
    mutationFn: (id: string) => apiFetch<Contract>(`/api/admin/contracts/${id}/issue`, { method: 'POST', body: '{}' }),
    onSuccess: async (result) => {
      message.success('合同已冻结并发送给指定用户')
      setDetail(result)
      await refresh()
    },
    onError: (error) => message.error(error.message),
  })
  const cancel = useMutation({
    mutationFn: (id: string) => apiFetch<Contract>(`/api/admin/contracts/${id}/cancel`, { method: 'POST', body: '{}' }),
    onSuccess: async (result) => {
      message.success('合同已取消')
      setDetail(result)
      await refresh()
    },
    onError: (error) => message.error(error.message),
  })
  const prepareEvidence = useMutation({
    mutationFn: async (values: { network: 'mainnet' | 'devnet' }) => {
      if (!publicKey) throw new Error('请先连接管理员钱包')
      return apiFetch<Prepared>('/api/admin/contracts/evidence/prepare', {
        method: 'POST',
        body: JSON.stringify({ contractId: Number(evidenceTarget!.id), network: values.network, signerAddress: publicKey.toBase58() }),
      })
    },
    onSuccess: (result) => setPrepared(result),
    onError: (error) => message.error(error.message),
  })
  const submitEvidence = useMutation({
    mutationFn: async (next: Prepared) => {
      if (!signTransaction || !publicKey || publicKey.toBase58() !== next.signerAddress) {
        throw new Error('当前钱包与待签合同凭证不一致')
      }
      let signedTransactionBase64: string
      try {
        signedTransactionBase64 = await signEvidenceTransaction(next.transactionBase64, signTransaction)
      } catch (error) {
        await apiFetch(`/api/admin/contracts/evidence/attempts/${next.attemptId}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ reason: error instanceof Error ? error.message : 'Wallet signature cancelled' }),
        }).catch(() => undefined)
        throw error
      }
      return apiFetch('/api/admin/contracts/evidence/submit', {
        method: 'POST',
        body: JSON.stringify({ attemptId: next.attemptId, signedTransactionBase64 }),
      })
    },
    onSuccess: async () => {
      message.success('交易已提交，系统将持续核验最终状态')
      setPrepared(null)
      await refresh()
    },
    onError: (error) => message.error(error.message),
  })
  const reconcile = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/contracts/evidence/${id}/reconcile`, { method: 'POST', body: '{}' }),
    onSuccess: async () => { message.success('链上状态已重新核验'); await refresh() },
    onError: (error) => message.error(error.message),
  })

  const openCreate = () => {
    setEditing(null)
    setAttachment(null)
    form.setFieldsValue({ subjectUserId: undefined, title: '', body: '' })
    setEditorOpen(true)
  }
  const openEdit = (contract: Contract) => {
    setEditing(contract)
    setAttachment(contract.attachment)
    form.setFieldsValue({ subjectUserId: Number(contract.subject.id), title: contract.title, body: contract.body })
    setEditorOpen(true)
  }
  const uploadPdf = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    try {
      const result = await apiFetch<{ id: string; originalName: string; fileSize: string }>('/api/admin/contracts/attachment', {
        method: 'POST',
        body: formData,
      })
      setAttachment(result)
      message.success('PDF 附件已上传，保存草稿后将被关联')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'PDF 上传失败')
    }
    return Upload.LIST_IGNORE
  }
  const openEvidence = (contract: Contract) => {
    setEvidenceTarget(contract)
    setPrepared(null)
    evidenceForm.setFieldsValue({ network: 'mainnet' })
  }

  return <AdminPage className={contractStyles.manager}>
    <AdminPageActions>
      <Space>
        <Button icon={<RefreshCw size={15} />} onClick={() => void contracts.refetch()}>刷新</Button>
        <Button type="primary" icon={<Plus size={15} />} onClick={openCreate}>新建合同</Button>
      </Space>
    </AdminPageActions>

    <AdminToolbar>
      <Input.Search
        allowClear
        value={keyword}
        placeholder="搜索合同标题"
        onChange={(event) => setKeyword(event.target.value)}
        onSearch={() => setPage(1)}
      />
      <Select
        allowClear
        placeholder="全部状态"
        value={status}
        style={{ width: 150 }}
        options={Object.entries(STATUS).map(([value, entry]) => ({ value: Number(value), label: entry.label }))}
        onChange={(value) => { setStatus(value); setPage(1) }}
      />
    </AdminToolbar>

    <AdminTablePanel>
      <Table<Contract>
        rowKey="id"
        loading={contracts.isLoading}
        dataSource={contracts.data?.list || []}
        pagination={{
          current: page,
          pageSize,
          total: contracts.data?.total || 0,
          showSizeChanger: true,
          onChange: (nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize) },
        }}
        scroll={{ x: 980 }}
        columns={[
          { title: '合同', dataIndex: 'title', minWidth: 240, render: (_value, item) => <div><strong>{item.title}</strong><br /><Typography.Text type="secondary" code>{compact(item.contractId)}</Typography.Text></div> },
          { title: '签约用户', width: 170, render: (_value, item) => <Space size={5}><UserRound size={15} />{item.subject.displayName || item.subject.username}</Space> },
          { title: '状态', dataIndex: 'status', width: 120, render: contractStatus },
          { title: '链上状态', width: 150, render: (_value, item) => item.credentials[0] ? <Tag color={CREDENTIAL_STATUS[item.credentials[0].status]?.color}>{CREDENTIAL_STATUS[item.credentials[0].status]?.label}</Tag> : '未发起' },
          { title: '发起时间', dataIndex: 'issuedAt', width: 176, render: (value) => value ? new Date(value).toLocaleString() : '—' },
          {
            title: '操作', fixed: 'right', width: 280,
            render: (_value, item) => <Space size={2} wrap>
              <Button type="link" onClick={() => setDetail(item)}>详情</Button>
              {item.status === 0 ? <Button type="link" icon={<FilePenLine size={14} />} onClick={() => openEdit(item)}>编辑</Button> : null}
              {item.status === 0 ? <Button type="link" icon={<Send size={14} />} loading={issue.isPending} onClick={() => modal.confirm({ title: '发起合同', content: '发起后正文和 PDF 附件将被冻结，指定用户可在账户中心签约。', okText: '冻结并发送', onOk: () => issue.mutateAsync(item.id) })}>发起</Button> : null}
              {(item.status === 0 || item.status === 1) ? <Button danger type="link" icon={<XCircle size={14} />} onClick={() => modal.confirm({ title: '取消合同', content: '取消后不能恢复或编辑该合同。', okText: '确认取消', okButtonProps: { danger: true }, onOk: () => cancel.mutateAsync(item.id) })}>取消</Button> : null}
              {item.status === 2 ? <Button type="link" icon={<Link2 size={14} />} onClick={() => openEvidence(item)}>上链存证</Button> : null}
              {item.credentials[0] && item.credentials[0].status !== 2 ? <Button type="link" onClick={() => reconcile.mutate(item.credentials[0].id)}>对账</Button> : null}
            </Space>,
          },
        ]}
      />
    </AdminTablePanel>

    <Drawer
      open={editorOpen}
      onClose={() => { setEditorOpen(false); setEditing(null); setAttachment(null); form.resetFields() }}
      width={620}
      title={editing ? '编辑合同草稿' : '新建合同草稿'}
      extra={<Button type="primary" loading={save.isPending} onClick={() => form.submit()}>保存草稿</Button>}
    >
      <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
        <Form.Item name="subjectUserId" label="签约用户" rules={[{ required: true, message: '请选择一名已启用用户' }]}>
          <Select showSearch optionFilterProp="label" options={subjectOptions} placeholder="选择用户" />
        </Form.Item>
        <Form.Item name="title" label="合同标题" rules={[{ required: true, whitespace: true, max: 255 }]}>
          <Input maxLength={255} placeholder="例如：服务确认协议" />
        </Form.Item>
        <Form.Item name="body" label="权威合同正文（Markdown）" rules={[{ required: true, whitespace: true, max: 100_000 }]}>
          <Input.TextArea rows={16} showCount maxLength={100_000} placeholder="此正文会在发起时冻结并计算 SHA-256。" />
        </Form.Item>
        <Form.Item label="PDF 附件（可选）" extra="PDF 是受保护的冻结附件；合同权威内容始终是上方正文。">
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {attachment ? <Alert type="success" showIcon message={attachment.originalName} description={`已选择 ${Math.ceil(Number(attachment.fileSize) / 1024)} KB PDF`} /> : null}
            <Upload accept="application/pdf,.pdf" maxCount={1} showUploadList={false} beforeUpload={uploadPdf}>
              <Button icon={<UploadCloud size={15} />}>上传 PDF</Button>
            </Upload>
            {attachment ? <Button type="link" danger onClick={() => setAttachment(null)}>移除草稿附件关联</Button> : null}
          </Space>
        </Form.Item>
      </Form>
    </Drawer>

    <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} width={760} title="合同快照与签约审计">
      {detail ? <ContractDetail contract={detail} admin /> : null}
    </Drawer>

    <Drawer open={Boolean(evidenceTarget)} onClose={() => { setEvidenceTarget(null); setPrepared(null) }} width={580} title="管理员链上存证">
      {evidenceTarget ? <>
        <Alert showIcon type="info" message="只有管理员钱包会签署链上交易" description="用户已通过 Web2 会话完成合同签约。Memo 仅写入合同哈希与链上核验字段，不包含正文、PDF 或身份信息。" />
        <Card className={contractStyles['evidence-card']} bordered={false}>
          <Descriptions column={1} size="small" items={[
            { key: 'title', label: '合同', children: evidenceTarget.title },
            { key: 'hash', label: '合同摘要', children: <Typography.Text code copyable>{evidenceTarget.contractHash}</Typography.Text> },
            { key: 'wallet', label: '当前钱包', children: publicKey ? <Typography.Text code>{publicKey.toBase58()}</Typography.Text> : '未连接' },
          ]} />
        </Card>
        <Form form={evidenceForm} layout="vertical" onFinish={(values) => prepareEvidence.mutate(values)}>
          <Form.Item name="network" label="存证网络" rules={[{ required: true }]}>
            <Select options={(networks.data?.networks || []).map((item) => ({ value: item.network, disabled: !item.enabled, label: item.network === 'mainnet' ? 'Mainnet · 正式链上存证' : 'Devnet · 测试凭证' }))} />
          </Form.Item>
          {prepared ? <Space direction="vertical" style={{ width: '100%' }}>
            <Alert type={prepared.network === 'mainnet' ? 'warning' : 'info'} showIcon message={prepared.network === 'mainnet' ? 'Mainnet 会消耗真实 SOL' : 'Devnet 仅用于测试'} description={`预计手续费 ${(prepared.feeLamports / 1_000_000_000).toFixed(9)} SOL；请求将在 ${new Date(prepared.expiresAt).toLocaleTimeString()} 失效。`} />
            <Button block type="primary" icon={<ShieldCheck size={15} />} loading={submitEvidence.isPending} disabled={!signTransaction || publicKey?.toBase58() !== prepared.signerAddress} onClick={() => submitEvidence.mutate(prepared)}>确认哈希并请求管理员钱包签名</Button>
            <Button block onClick={() => setPrepared(null)}>返回修改</Button>
          </Space> : <Button block type="primary" icon={<FileSignature size={15} />} loading={prepareEvidence.isPending} disabled={!publicKey || !connection} htmlType="submit">生成待签链上交易</Button>}
        </Form>
      </> : null}
    </Drawer>
  </AdminPage>
}

function ContractDetail({ contract, admin }: { contract: Contract; admin?: boolean }) {
  return <div className={contractStyles.detail}>
    <section className={contractStyles.paper}>
      <div className={contractStyles['paper-header']}><FileCheck2 size={18} /><div><Typography.Text type="secondary">FROZEN CONTRACT</Typography.Text><Typography.Title level={3}>{contract.title}</Typography.Title></div></div>
      <Descriptions column={1} size="small" items={[
        { key: 'state', label: '状态', children: contractStatus(contract.status) },
        { key: 'id', label: '合同编号', children: <Typography.Text code copyable>{contract.contractId}</Typography.Text> },
        { key: 'body', label: '正文 SHA-256', children: <Typography.Text code copyable>{contract.bodyHash}</Typography.Text> },
        { key: 'root', label: '合同根哈希', children: contract.contractHash ? <Typography.Text code copyable>{contract.contractHash}</Typography.Text> : '待用户签约后生成' },
        { key: 'pdf', label: 'PDF 附件', children: contract.attachment ? <a href={`${admin ? '/api/admin/contracts' : '/api/account/contracts'}/${contract.id}/attachment`} target="_blank" rel="noreferrer">{contract.attachment.originalName}</a> : '无' },
        { key: 'issued', label: '发起时间', children: contract.issuedAt ? new Date(contract.issuedAt).toLocaleString() : '未发起' },
        { key: 'signed', label: '签约时间', children: contract.signedAt ? new Date(contract.signedAt).toLocaleString() : '未签约' },
      ]} />
      <div className={contractStyles.body}><MarkdownView content={contract.body} /></div>
    </section>
    {contract.declineReason ? <Alert type="error" showIcon message="用户已拒签" description={contract.declineReason} /> : null}
    {admin && contract.signedAudit ? <Card size="small" title="Web2 签约审计"><Descriptions column={1} size="small" items={[
      { key: 'session', label: '会话引用', children: <Typography.Text code>{contract.signedAudit.sessionId || '—'}</Typography.Text> },
      { key: 'ip', label: '客户端 IP', children: contract.signedAudit.ip || '—' },
      { key: 'ua', label: 'User-Agent', children: contract.signedAudit.userAgent || '—' },
    ]} /></Card> : null}
    {admin && contract.adminAudit?.length ? <Card size="small" title="管理员操作审计"><Descriptions column={1} size="small" items={contract.adminAudit.map((audit) => ({
      key: audit.id,
      label: ADMIN_AUDIT_ACTION[audit.action] || audit.action,
      children: `${audit.actor.displayName || audit.actor.username} · ${new Date(audit.createdAt).toLocaleString()}`,
    }))} /></Card> : null}
    {contract.credentials.map((credential) => <Card key={credential.id} size="small" title={<Space><BadgeCheck size={15} />{credential.network === 'mainnet' ? 'Mainnet 凭证' : 'Devnet 测试凭证'}<Tag color={CREDENTIAL_STATUS[credential.status]?.color}>{CREDENTIAL_STATUS[credential.status]?.label}</Tag></Space>}>
      <Typography.Text code>{credential.transactionSignature || '尚未生成交易签名'}</Typography.Text>
      {credential.transactionSignature ? <div><a href={`/contract-evidence/${credential.transactionSignature}`} target="_blank" rel="noreferrer">打开公开核验页</a></div> : null}
    </Card>)}
  </div>
}
