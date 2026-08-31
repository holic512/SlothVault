'use client'

/**
 * @file contracts-manager.tsx
 * @project SlothVault
 * @module Contract Administration
 * @description Provides the administrator workspace for drafting, issuing, inspecting, and anchoring one-to-one Web2 contracts.
 * @logic Keep editable drafts separate from frozen snapshots, let administrators inspect the exact user response timeline, and route a signed contract through the existing wallet transaction ceremony only after its Web2 signature succeeds.
 * @dependencies React Query, Ant Design, use-solana-wallet, MarkdownView, contract APIs
 * @index_tags admin,contracts,drafts,web2-signature,solana,evidence,attachments
 * @author holic512
 */
import { useMemo, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Alert, Button, Card, Descriptions, Drawer, Form, Input, Select, Space, Table, Tag, Typography, Upload } from 'antd'
import { BadgeCheck, FileCheck2, FilePenLine, FileSignature, Link2, Plus, RefreshCw, Send, ShieldCheck, UploadCloud, UserRound, XCircle } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { AdminPage, AdminPageActions, AdminTablePanel, AdminToolbar } from '@/components/admin/admin-page'
import { MarkdownView } from '@/components/markdown/markdown-view'
import { useSolanaWallet } from '@/components/wallet/use-solana-wallet'
import { formatAdminDate, formatAdminError } from '@/lib/admin-localization'
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

const STATUS: Record<number, { key: 'cancelled' | 'declined' | 'draft' | 'pending' | 'signed'; color: string }> = {
  [-2]: { key: 'cancelled', color: 'default' },
  [-1]: { key: 'declined', color: 'error' },
  0: { key: 'draft', color: 'default' },
  1: { key: 'pending', color: 'processing' },
  2: { key: 'signed', color: 'success' },
}

const CREDENTIAL_STATUS: Record<number, { key: 'failed' | 'awaitingWallet' | 'confirming' | 'anchored'; color: string }> = {
  [-1]: { key: 'failed', color: 'error' },
  0: { key: 'awaitingWallet', color: 'default' },
  1: { key: 'confirming', color: 'processing' },
  2: { key: 'anchored', color: 'success' },
}

function contractStatus(status: number, t: ReturnType<typeof useTranslations<'AdminMM.contracts'>>) {
  const entry = STATUS[status] || { key: 'unknown' as const, color: 'default' }
  return <Tag color={entry.color}>{t(`status.${entry.key}`)}</Tag>
}

function compact(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

export function ContractsManager() {
  const t = useTranslations('AdminMM.contracts')
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const wallet = useSolanaWallet()
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
      message.success(editing ? t('messages.draftSaved') : t('messages.draftCreated'))
      setEditorOpen(false)
      setEditing(null)
      setAttachment(null)
      form.resetFields()
      await refresh()
    },
    onError: (error) => message.error(formatAdminError(error, errorT)),
  })
  const issue = useMutation({
    mutationFn: (id: string) => apiFetch<Contract>(`/api/admin/contracts/${id}/issue`, { method: 'POST', body: '{}' }),
    onSuccess: async (result) => {
      message.success(t('messages.issued'))
      setDetail(result)
      await refresh()
    },
    onError: (error) => message.error(formatAdminError(error, errorT)),
  })
  const cancel = useMutation({
    mutationFn: (id: string) => apiFetch<Contract>(`/api/admin/contracts/${id}/cancel`, { method: 'POST', body: '{}' }),
    onSuccess: async (result) => {
      message.success(t('messages.cancelled'))
      setDetail(result)
      await refresh()
    },
    onError: (error) => message.error(formatAdminError(error, errorT)),
  })
  const prepareEvidence = useMutation({
    mutationFn: async (values: { network: 'mainnet' | 'devnet' }) => {
      if (!wallet.address) throw new Error(t('messages.connectWallet'))
      return apiFetch<Prepared>('/api/admin/contracts/evidence/prepare', {
        method: 'POST',
        body: JSON.stringify({ contractId: Number(evidenceTarget!.id), network: values.network, signerAddress: wallet.address }),
      })
    },
    onSuccess: (result) => setPrepared(result),
    onError: (error) => message.error(formatAdminError(error, errorT)),
  })
  const submitEvidence = useMutation({
    mutationFn: async (next: Prepared) => {
      if (!wallet.canSignTransaction || wallet.address !== next.signerAddress) {
        throw new Error(t('messages.walletMismatch'))
      }
      let signedTransactionBase64: string
      try {
        signedTransactionBase64 = await wallet.signPreparedTransaction(next.transactionBase64)
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
      message.success(t('messages.submitted'))
      setPrepared(null)
      await refresh()
    },
    onError: (error) => message.error(formatAdminError(error, errorT)),
  })
  const reconcile = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/contracts/evidence/${id}/reconcile`, { method: 'POST', body: '{}' }),
    onSuccess: async () => { message.success(t('messages.reconciled')); await refresh() },
    onError: (error) => message.error(formatAdminError(error, errorT)),
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
      message.success(t('messages.attachmentUploaded'))
    } catch (error) {
      message.error(formatAdminError(error, errorT))
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
        <Button icon={<RefreshCw size={15} />} onClick={() => void contracts.refetch()}>{t('actions.refresh')}</Button>
        <Button type="primary" icon={<Plus size={15} />} onClick={openCreate}>{t('actions.create')}</Button>
      </Space>
    </AdminPageActions>

    <AdminToolbar>
      <Input.Search
        allowClear
        value={keyword}
        placeholder={t('filters.keyword')}
        onChange={(event) => setKeyword(event.target.value)}
        onSearch={() => setPage(1)}
      />
      <Select
        allowClear
        placeholder={t('filters.allStatus')}
        value={status}
        style={{ width: 150 }}
        options={Object.entries(STATUS).map(([value, entry]) => ({ value: Number(value), label: t(`status.${entry.key}`) }))}
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
          { title: t('table.contract'), dataIndex: 'title', minWidth: 240, render: (_value, item) => <div><strong>{item.title}</strong><br /><Typography.Text type="secondary" code>{compact(item.contractId)}</Typography.Text></div> },
          { title: t('table.subject'), width: 170, render: (_value, item) => <Space size={5}><UserRound size={15} />{item.subject.displayName || item.subject.username}</Space> },
          { title: t('table.status'), dataIndex: 'status', width: 120, render: (value) => contractStatus(value, t) },
          { title: t('table.evidenceStatus'), width: 150, render: (_value, item) => item.credentials[0] ? <Tag color={CREDENTIAL_STATUS[item.credentials[0].status]?.color}>{t(`credentialStatus.${CREDENTIAL_STATUS[item.credentials[0].status]?.key || 'failed'}`)}</Tag> : t('notIssued') },
          { title: t('table.issuedAt'), dataIndex: 'issuedAt', width: 176, render: (value) => value ? formatAdminDate(locale, value) : t('empty') },
          {
            title: t('table.operations'), fixed: 'right', width: 280,
            render: (_value, item) => <Space size={2} wrap>
              <Button type="link" onClick={() => setDetail(item)}>{t('actions.details')}</Button>
              {item.status === 0 ? <Button type="link" icon={<FilePenLine size={14} />} onClick={() => openEdit(item)}>{t('actions.edit')}</Button> : null}
              {item.status === 0 ? <Button type="link" icon={<Send size={14} />} loading={issue.isPending} onClick={() => modal.confirm({ title: t('dialog.issueTitle'), content: t('dialog.issueContent'), okText: t('dialog.issueOk'), onOk: () => issue.mutateAsync(item.id) })}>{t('actions.issue')}</Button> : null}
              {(item.status === 0 || item.status === 1) ? <Button danger type="link" icon={<XCircle size={14} />} onClick={() => modal.confirm({ title: t('dialog.cancelTitle'), content: t('dialog.cancelContent'), okText: t('dialog.cancelOk'), okButtonProps: { danger: true }, onOk: () => cancel.mutateAsync(item.id) })}>{t('actions.cancel')}</Button> : null}
              {item.status === 2 ? <Button type="link" icon={<Link2 size={14} />} onClick={() => openEvidence(item)}>{t('actions.evidence')}</Button> : null}
              {item.credentials[0] && item.credentials[0].status !== 2 ? <Button type="link" onClick={() => reconcile.mutate(item.credentials[0].id)}>{t('actions.reconcile')}</Button> : null}
            </Space>,
          },
        ]}
      />
    </AdminTablePanel>

    <Drawer
      open={editorOpen}
      onClose={() => { setEditorOpen(false); setEditing(null); setAttachment(null); form.resetFields() }}
      size={620}
      title={editing ? t('drawer.edit') : t('drawer.create')}
      extra={<Button type="primary" loading={save.isPending} onClick={() => form.submit()}>{t('actions.saveDraft')}</Button>}
    >
      <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
        <Form.Item name="subjectUserId" label={t('form.subject')} rules={[{ required: true, message: t('form.subjectRequired') }]}>
          <Select showSearch optionFilterProp="label" options={subjectOptions} placeholder={t('form.selectSubject')} />
        </Form.Item>
        <Form.Item name="title" label={t('form.title')} rules={[{ required: true, whitespace: true, max: 255 }]}>
          <Input maxLength={255} placeholder={t('form.titlePlaceholder')} />
        </Form.Item>
        <Form.Item name="body" label={t('form.body')} rules={[{ required: true, whitespace: true, max: 100_000 }]}>
          <Input.TextArea rows={16} showCount maxLength={100_000} placeholder={t('form.bodyPlaceholder')} />
        </Form.Item>
        <Form.Item label={t('form.attachment')} extra={t('form.attachmentHint')}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {attachment ? <Alert type="success" showIcon message={attachment.originalName} description={t('detail.selectedPdf', { size: Math.ceil(Number(attachment.fileSize) / 1024) })} /> : null}
            <Upload accept="application/pdf,.pdf" maxCount={1} showUploadList={false} beforeUpload={uploadPdf}>
              <Button icon={<UploadCloud size={15} />}>{t('actions.uploadPdf')}</Button>
            </Upload>
            {attachment ? <Button type="link" danger onClick={() => setAttachment(null)}>{t('actions.removeAttachment')}</Button> : null}
          </Space>
        </Form.Item>
      </Form>
    </Drawer>

    <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} size={760} title={t('drawer.detail')}>
      {detail ? <ContractDetail contract={detail} admin /> : null}
    </Drawer>

    <Drawer open={Boolean(evidenceTarget)} onClose={() => { setEvidenceTarget(null); setPrepared(null) }} size={580} title={t('drawer.evidence')}>
      {evidenceTarget ? <>
        <Alert showIcon type="info" message={t('dialog.adminWallet')} description={t('dialog.adminWalletDescription')} />
        <Card className={contractStyles['evidence-card']} bordered={false}>
          <Descriptions column={1} size="small" items={[
            { key: 'title', label: t('detail.contract'), children: evidenceTarget.title },
            { key: 'hash', label: t('detail.summary'), children: <Typography.Text code copyable>{evidenceTarget.contractHash}</Typography.Text> },
            { key: 'wallet', label: t('detail.wallet'), children: wallet.address ? <Typography.Text code>{wallet.address}</Typography.Text> : t('detail.notConnected') },
          ]} />
        </Card>
        <Form form={evidenceForm} layout="vertical" onFinish={(values) => prepareEvidence.mutate(values)}>
          <Form.Item name="network" label={t('form.network')} rules={[{ required: true }]}>
            <Select options={(networks.data?.networks || []).map((item) => ({ value: item.network, disabled: !item.enabled, label: item.network === 'mainnet' ? t('detail.mainnetCredential') : t('detail.devnetCredential') }))} />
          </Form.Item>
          {prepared ? <Space direction="vertical" style={{ width: '100%' }}>
            <Alert type={prepared.network === 'mainnet' ? 'warning' : 'info'} showIcon message={prepared.network === 'mainnet' ? t('dialog.mainnetFee') : t('dialog.devnetTest')} description={t('dialog.feeExpires', { fee: (prepared.feeLamports / 1_000_000_000).toFixed(9), date: formatAdminDate(locale, new Date(prepared.expiresAt)) })} />
            <Button block type="primary" icon={<ShieldCheck size={15} />} loading={submitEvidence.isPending} disabled={!wallet.canSignTransaction || wallet.address !== prepared.signerAddress} onClick={() => submitEvidence.mutate(prepared)}>{t('actions.sign')}</Button>
            <Button block onClick={() => setPrepared(null)}>{t('actions.back')}</Button>
          </Space> : <Button block type="primary" icon={<FileSignature size={15} />} loading={prepareEvidence.isPending} disabled={!wallet.address || !wallet.canSignTransaction} htmlType="submit">{t('actions.prepare')}</Button>}
        </Form>
      </> : null}
    </Drawer>
  </AdminPage>
}

function ContractDetail({ contract, admin }: { contract: Contract; admin?: boolean }) {
  const t = useTranslations('AdminMM.contracts')
  const locale = useLocale()
  return <div className={contractStyles.detail}>
    <section className={contractStyles.paper}>
      <div className={contractStyles['paper-header']}><FileCheck2 size={18} /><div><Typography.Text type="secondary">{t('detail.frozen')}</Typography.Text><Typography.Title level={3}>{contract.title}</Typography.Title></div></div>
      <Descriptions column={1} size="small" items={[
        { key: 'state', label: t('detail.state'), children: contractStatus(contract.status, t) },
        { key: 'id', label: t('detail.id'), children: <Typography.Text code copyable>{contract.contractId}</Typography.Text> },
        { key: 'body', label: t('detail.bodyHash'), children: <Typography.Text code copyable>{contract.bodyHash}</Typography.Text> },
        { key: 'root', label: t('detail.rootHash'), children: contract.contractHash ? <Typography.Text code copyable>{contract.contractHash}</Typography.Text> : t('detail.pendingRootHash') },
        { key: 'pdf', label: t('detail.attachment'), children: contract.attachment ? <a href={`${admin ? '/api/admin/contracts' : '/api/account/contracts'}/${contract.id}/attachment`} target="_blank" rel="noreferrer">{contract.attachment.originalName}</a> : t('detail.none') },
        { key: 'issued', label: t('detail.issuedAt'), children: contract.issuedAt ? formatAdminDate(locale, contract.issuedAt) : t('notIssued') },
        { key: 'signed', label: t('detail.signedAt'), children: contract.signedAt ? formatAdminDate(locale, contract.signedAt) : t('detail.notSigned') },
      ]} />
      <div className={contractStyles.body}><MarkdownView content={contract.body} /></div>
    </section>
    {contract.declineReason ? <Alert type="error" showIcon message={t('detail.declined')} description={contract.declineReason} /> : null}
    {admin && contract.signedAudit ? <Card size="small" title={t('detail.web2Audit')}><Descriptions column={1} size="small" items={[
      { key: 'session', label: t('detail.session'), children: <Typography.Text code>{contract.signedAudit.sessionId || t('empty')}</Typography.Text> },
      { key: 'ip', label: t('detail.ip'), children: contract.signedAudit.ip || t('empty') },
      { key: 'ua', label: t('detail.userAgent'), children: contract.signedAudit.userAgent || t('empty') },
    ]} /></Card> : null}
    {admin && contract.adminAudit?.length ? <Card size="small" title={t('detail.adminAudit')}><Descriptions column={1} size="small" items={contract.adminAudit.map((audit) => ({
      key: audit.id,
      label: t.has(`audit.${audit.action}`) ? t(`audit.${audit.action}`) : audit.action,
      children: `${audit.actor.displayName || audit.actor.username} · ${formatAdminDate(locale, audit.createdAt)}`,
    }))} /></Card> : null}
    {contract.credentials.map((credential) => <Card key={credential.id} size="small" title={<Space><BadgeCheck size={15} />{credential.network === 'mainnet' ? t('detail.mainnetCredential') : t('detail.devnetCredential')}<Tag color={CREDENTIAL_STATUS[credential.status]?.color}>{t(`credentialStatus.${CREDENTIAL_STATUS[credential.status]?.key || 'failed'}`)}</Tag></Space>}>
      <Typography.Text code>{credential.transactionSignature || t('detail.noSignature')}</Typography.Text>
      {credential.transactionSignature ? <div><a href={`/contract-evidence/${credential.transactionSignature}`} target="_blank" rel="noreferrer">{t('detail.openVerification')}</a></div> : null}
    </Card>)}
  </div>
}
