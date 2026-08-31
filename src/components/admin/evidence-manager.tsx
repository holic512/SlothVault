'use client'

/**
 * @file evidence-manager.tsx
 * @project SlothVault
 * @module Unified Evidence Administration
 * @description Provides one receipt ledger for legacy project-version and note-content evidence with cascaded content selection.
 * @logic Filter both evidence subjects, guide project-to-content signing for new records, and retain subject-aware retry and reconciliation beside each attempt timeline.
 * @dependencies React Query, Ant Design, use-solana-wallet, release evidence APIs
 * @index_tags admin,evidence,solana,wallet,receipts,reconciliation
 * @author holic512
 */
import { useEffect, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  App,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  BadgeCheck,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileSignature,
  FlaskConical,
  RefreshCw,
  Search,
  WalletCards,
} from 'lucide-react'

import { AdminPage, AdminPageActions, AdminTablePanel, AdminToolbar } from '@/components/admin/admin-page'
import { useSolanaWallet } from '@/components/wallet/use-solana-wallet'
import { apiFetch, ApiClientError } from '@/lib/api-client'

type Network = 'mainnet' | 'devnet'
type SubjectType = 'PROJECT_VERSION' | 'NOTE_CONTENT'
type Attempt = {
  id: string
  status: number
  signerAddress: string
  transactionSignature: string | null
  failureCode: string | null
  failureMessage: string | null
  expiresAt: string
  submittedAt: string | null
  finalizedAt: string | null
  createdAt: string
}
type Evidence = {
  id: string
  subjectType: SubjectType
  subjectId: string | null
  subjectHash: string | null
  subjectManifestVersion: number | null
  projectVersionId: string
  noteContentId: string | null
  projectId: string
  projectName: string
  version: string
  categoryName: string | null
  noteId: string | null
  noteTitle: string | null
  contentVersion: string | null
  isPrimary: boolean | null
  releaseHash: string | null
  network: Network
  signerAddress: string
  transactionSignature: string | null
  status: number
  feeLamports: string | null
  blockTime: string | null
  finalizedAt: string | null
  attempts: Attempt[]
}
type EvidenceData = {
  list: Evidence[]
  total: number
  page: number
  pageSize: number
  summary: Array<{ network: Network; status: number; count: number }>
  defaultNetwork: Network
  networks: Array<{
    network: Network
    enabled: boolean
    hasFallback: boolean
    health: { testedAt: string; primary: { ok: boolean }; fallback: { configured: boolean; ok: boolean } } | null
  }>
}
type PublishedVersion = {
  id: string
  version: string
  releaseHash: string | null
  publishedAt: string | null
  project: { id: string; projectName: string } | null
}
type ProjectOption = { id: string; projectName: string }
type CategoryOption = { id: string; categoryName: string }
type NoteOption = { id: string; noteTitle: string }
type ContentOption = {
  id: string
  versionNote: string | null
  isPrimary: boolean
  status: number
  isDeleted: boolean
}
type Prepared = {
  attemptId: string
  transactionBase64: string
  expiresAt: number
  feeLamports: number
  balanceLamports: number
  memo: string
  signerAddress: string
  subjectType: SubjectType
  project: string
  version: string
  category: string | null
  note: string | null
  contentVersion: string | null
  releaseHash: string
  network: Network
}

const STATUS = {
  [-1]: { label: '失败', color: 'error', icon: <CircleAlert size={14} /> },
  [0]: { label: '待签名', color: 'default', icon: <FileSignature size={14} /> },
  [1]: { label: '待确认', color: 'processing', icon: <Clock3 size={14} /> },
  [2]: { label: '已确认', color: 'success', icon: <BadgeCheck size={14} /> },
} as const

function compact(value: string | null, head = 9, tail = 7) {
  if (!value) return '—'
  return value.length > head + tail ? `${value.slice(0, head)}…${value.slice(-tail)}` : value
}

function explorerUrl(signature: string, network: Network) {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${network === 'devnet' ? '?cluster=devnet' : ''}`
}

function evidenceErrorMessage(error: unknown) {
  if (!(error instanceof ApiClientError)) {
    return error instanceof Error ? error.message : '存证操作失败，请稍后重试'
  }
  const reason = error.data && typeof error.data === 'object' && 'reason' in error.data
    ? String(error.data.reason)
    : ''
  if (reason === 'EVIDENCE_BALANCE_INSUFFICIENT') {
    return '钱包余额不足，请补充所选网络的 SOL 后重新办理。'
  }
  if (reason === 'EVIDENCE_NETWORK_DISABLED') {
    return '该网络已禁用，请选择其他已启用网络或前往系统设置调整。'
  }
  if (reason === 'RELEASE_INTEGRITY_FAILED') {
    return '版本完整性校验失败，请先修复版本内容与发布哈希的不一致。'
  }
  if (error.status === 503) {
    return 'Solana RPC 暂时不可用，请检测网络或稍后重试；已提交记录可使用“对账”。'
  }
  return error.message
}

export function EvidenceManager() {
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const wallet = useSolanaWallet()
  const [scope, setScope] = useState<'all' | 'wallet'>('all')
  const [subjectType, setSubjectType] = useState<SubjectType | undefined>()
  const [network, setNetwork] = useState<Network | undefined>()
  const [status, setStatus] = useState<number | undefined>()
  const [signature, setSignature] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Evidence | null>(null)
  const [issueOpen, setIssueOpen] = useState(false)
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [retrySubject, setRetrySubject] = useState<Evidence | null>(null)
  const [issueProjectId, setIssueProjectId] = useState('')
  const [issueVersionId, setIssueVersionId] = useState('')
  const [issueCategoryId, setIssueCategoryId] = useState('')
  const [issueNoteId, setIssueNoteId] = useState('')
  const [form] = Form.useForm<{ noteContentId: number; network: Network }>()
  const signer = wallet.address || ''

  const query = useQuery({
    queryKey: ['release-evidence', scope, signer, subjectType, network, status, signature, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' })
      if (scope === 'wallet' && signer) params.set('signerAddress', signer)
      if (subjectType) params.set('subjectType', subjectType)
      if (network) params.set('network', network)
      if (status !== undefined) params.set('status', String(status))
      if (signature.trim()) params.set('transactionSignature', signature.trim())
      return apiFetch<EvidenceData>(`/api/admin/evidence?${params}`)
    },
    enabled: scope === 'all' || Boolean(signer),
  })
  const projectsQuery = useQuery({
    queryKey: ['evidence-project-options'],
    enabled: issueOpen && !retrySubject,
    queryFn: () => apiFetch<{ list: ProjectOption[] }>('/api/admin/mm/project?pageSize=100'),
  })
  const versionsQuery = useQuery({
    queryKey: ['published-versions-for-evidence', issueProjectId],
    enabled: issueOpen && !retrySubject && Boolean(issueProjectId),
    queryFn: () => apiFetch<{ list: PublishedVersion[] }>(`/api/admin/mm/projectVersion/byProject/${issueProjectId}?pageSize=100&orderBy=updatedAt&order=desc`),
  })
  const categoriesQuery = useQuery({
    queryKey: ['evidence-category-options', issueVersionId],
    enabled: issueOpen && !retrySubject && Boolean(issueVersionId),
    queryFn: () => apiFetch<{ list: CategoryOption[] }>(`/api/admin/mm/category/byProjectVersion/${issueVersionId}?pageSize=100`),
  })
  const notesQuery = useQuery({
    queryKey: ['evidence-note-options', issueCategoryId],
    enabled: issueOpen && !retrySubject && Boolean(issueCategoryId),
    queryFn: () => apiFetch<{ list: NoteOption[] }>(`/api/admin/mm/note?pageSize=100&categoryId=${issueCategoryId}`),
  })
  const contentsQuery = useQuery({
    queryKey: ['evidence-content-options', issueNoteId],
    enabled: issueOpen && !retrySubject && Boolean(issueNoteId),
    queryFn: () => apiFetch<{ list: ContentOption[] }>(`/api/admin/mm/noteContent?noteInfoId=${issueNoteId}`),
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['release-evidence'] })
  const reconcile = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/evidence/${id}/reconcile`, { method: 'POST', body: '{}' }),
    onSuccess: async () => { message.success('链上状态已重新核验'); await refresh() },
    onError: (error) => message.error(evidenceErrorMessage(error)),
  })
  useEffect(() => {
    if (
      query.data?.defaultNetwork &&
      !prepared &&
      !form.getFieldValue('network')
    ) {
      form.setFieldValue('network', query.data.defaultNetwork)
    }
  }, [form, prepared, query.data?.defaultNetwork])

  const prepare = useMutation({
    mutationFn: async (values: { noteContentId: number; network: Network }) => {
      if (!signer) throw new Error('请先连接用于签名的钱包')
      const subject = retrySubject
        ? retrySubject.subjectType === 'NOTE_CONTENT'
          ? { type: 'noteContent' as const, noteContentId: Number(retrySubject.noteContentId) }
          : { type: 'projectVersion' as const, projectVersionId: Number(retrySubject.projectVersionId) }
        : { type: 'noteContent' as const, noteContentId: values.noteContentId }
      return apiFetch<Prepared>('/api/admin/evidence/prepare', {
        method: 'POST',
        body: JSON.stringify({ subject, network: values.network, signerAddress: signer }),
      })
    },
    onSuccess: (next) => setPrepared(next),
    onError: (error) => message.error(evidenceErrorMessage(error)),
  })
  const submit = useMutation({
    mutationFn: async (next: Prepared) => {
      if (!signer || signer !== next.signerAddress) {
        throw new Error('当前钱包已变化，请重新校验并生成待签交易')
      }
      let signedTransactionBase64: string
      try {
        if (next.network === 'mainnet') {
          await new Promise<void>((resolve, reject) => modal.confirm({
            title: '确认使用真实 SOL 办理正式存证？',
            content: `预计费用 ${(next.feeLamports / 1_000_000_000).toFixed(9)} SOL。Mainnet 存证将作为本站正式凭证。`,
            okText: '确认签名',
            okButtonProps: { danger: true },
            onOk: resolve,
            onCancel: () => reject(new Error('已取消 Mainnet 签名')),
          }))
        }
        signedTransactionBase64 = await wallet.signPreparedTransaction(next.transactionBase64)
      } catch (error) {
        await apiFetch(`/api/admin/evidence/attempts/${next.attemptId}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ reason: error instanceof Error ? error.message : 'Wallet signature cancelled' }),
        }).catch(() => undefined)
        setPrepared(null)
        throw error
      }
      return apiFetch('/api/admin/evidence/submit', {
        method: 'POST',
        body: JSON.stringify({ attemptId: next.attemptId, signedTransactionBase64 }),
      })
    },
    onSuccess: async () => {
      message.success('交易已提交，系统将持续等待最终确认')
      setIssueOpen(false)
      setPrepared(null)
      setRetrySubject(null)
      form.resetFields()
      await refresh()
    },
    onError: (error) => message.error(evidenceErrorMessage(error)),
  })

  const cancelPrepared = async (reason: string) => {
    const current = prepared
    setPrepared(null)
    if (!current) return
    await apiFetch(`/api/admin/evidence/attempts/${current.attemptId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }).catch((error) => message.warning(`未签请求将在到期后自动失效：${error.message}`))
  }

  const openIssue = (row?: Evidence) => {
    setRetrySubject(row || null)
    form.setFieldsValue({
      noteContentId: row?.noteContentId ? Number(row.noteContentId) : undefined,
      network: row?.network ?? query.data?.defaultNetwork ?? 'devnet',
    })
    setIssueProjectId('')
    setIssueVersionId('')
    setIssueCategoryId('')
    setIssueNoteId('')
    setPrepared(null)
    setIssueOpen(true)
  }

  const columns: ColumnsType<Evidence> = [
    {
      title: '存证对象',
      render: (_, row) => <div>
        <Space size={5}><strong>{row.projectName}</strong><Tag bordered={false}>{row.subjectType === 'NOTE_CONTENT' ? '笔记内容' : '整版发布'}</Tag></Space>
        <br />
        <Typography.Text type="secondary">
          {row.subjectType === 'NOTE_CONTENT'
            ? `${row.version} / ${row.categoryName || '—'} / ${row.noteTitle || '—'} / ${row.contentVersion || '未命名版本'}`
            : row.version}
        </Typography.Text>
      </div>,
    },
    {
      title: '网络', width: 115, render: (_, row) => row.network === 'devnet'
        ? <Tag icon={<FlaskConical size={12} />} color="warning">测试凭证</Tag>
        : <Tag icon={<BadgeCheck size={12} />} color="success">正式凭证</Tag>,
    },
    { title: '状态', width: 105, render: (_, row) => <Tag color={STATUS[row.status as keyof typeof STATUS]?.color} icon={STATUS[row.status as keyof typeof STATUS]?.icon}>{STATUS[row.status as keyof typeof STATUS]?.label || row.status}</Tag> },
    { title: '交易编号', width: 190, render: (_, row) => row.transactionSignature ? <Tooltip title={row.transactionSignature}><code>{compact(row.transactionSignature)}</code></Tooltip> : '—' },
    {
      title: '操作', width: 170, fixed: 'right', render: (_, row) => <Space size={2}>
        <Button type="link" onClick={() => setSelected(row)}>详情</Button>
        {row.status === -1 ? <Button type="link" onClick={() => openIssue(row)}>重试</Button> : null}
        {row.status === 0 || row.status === 1 ? <Button type="link" loading={reconcile.isPending} onClick={() => reconcile.mutate(row.id)}>对账</Button> : null}
        {row.transactionSignature ? <Button type="link" href={`/evidence/${row.transactionSignature}`} target="_blank">核验</Button> : null}
      </Space>,
    },
  ]

  return <AdminPage>
    <AdminPageActions>
      <Space wrap>
        <Button icon={<RefreshCw size={15} />} loading={query.isFetching} onClick={() => void query.refetch()}>刷新</Button>
        <Button type="primary" icon={<FileSignature size={15} />} onClick={() => openIssue()}>办理笔记存证</Button>
      </Space>
    </AdminPageActions>

    <AdminToolbar className="evidence-toolbar">
      <div className="evidence-toolbar-primary">
        <div className="evidence-toolbar-heading">
          <Typography.Text strong>存证总账</Typography.Text>
          <Typography.Text type="secondary">{query.data?.total || 0} 条记录</Typography.Text>
        </div>
        <Segmented options={[{ label: '全部', value: 'all' }, { label: '我的钱包', value: 'wallet', icon: <WalletCards size={14} /> }]} value={scope} onChange={(value) => { setScope(value as 'all' | 'wallet'); setPage(1) }} />
      </div>
      <Space className="evidence-toolbar-filters" wrap>
          <Select allowClear placeholder="对象类型" value={subjectType} onChange={(value) => { setSubjectType(value); setPage(1) }} options={[{ value: 'NOTE_CONTENT', label: '笔记内容' }, { value: 'PROJECT_VERSION', label: '整版发布（兼容）' }]} />
          <Select allowClear placeholder="网络" value={network} onChange={(value) => { setNetwork(value); setPage(1) }} options={[{ value: 'mainnet', label: 'Mainnet · 正式' }, { value: 'devnet', label: 'Devnet · 测试' }]} />
          <Select allowClear placeholder="状态" value={status} onChange={(value) => { setStatus(value); setPage(1) }} options={Object.entries(STATUS).map(([value, item]) => ({ value: Number(value), label: item.label }))} />
          <Input allowClear prefix={<Search size={14} />} placeholder="交易编号" value={signature} onChange={(event) => { setSignature(event.target.value); setPage(1) }} />
      </Space>
    </AdminToolbar>
    <AdminTablePanel className="evidence-ledger">
      {query.isError ? <Alert showIcon type="error" message="存证记录加载失败" description={evidenceErrorMessage(query.error)} action={<Button size="small" onClick={() => void query.refetch()}>重试</Button>} /> : null}
      {scope === 'wallet' && !signer ? <Alert showIcon type="info" message="连接钱包后，将只显示本站由该地址签署的凭证；不会扫描钱包的全部链上历史。" /> : null}
      <Table rowKey="id" size="small" loading={query.isLoading} dataSource={query.data?.list || []} columns={columns} scroll={{ x: 1080 }} pagination={{ current: page, pageSize: 20, total: query.data?.total || 0, showSizeChanger: false, onChange: setPage }} />
      <div className="evidence-mobile-list">
        {!query.isLoading && (query.data?.list.length || 0) === 0 ? <Empty description="暂无存证记录" /> : null}
        {(query.data?.list || []).map((row) => <article className="evidence-mobile-card" key={row.id}>
          <div><strong>{row.subjectType === 'NOTE_CONTENT' ? `${row.noteTitle || '笔记'} / ${row.contentVersion || '未命名版本'}` : `${row.projectName} / ${row.version}`}</strong><Tag color={row.network === 'devnet' ? 'warning' : 'success'}>{row.network === 'devnet' ? '测试凭证' : '正式存证'}</Tag></div>
          <code title={row.subjectHash || ''}>{compact(row.subjectHash, 14, 10)}</code>
          <Space><Tag color={STATUS[row.status as keyof typeof STATUS]?.color}>{STATUS[row.status as keyof typeof STATUS]?.label}</Tag><Typography.Text type="secondary">{compact(row.signerAddress)}</Typography.Text></Space>
          <Space><Button size="small" onClick={() => setSelected(row)}>详情</Button>{row.status === -1 ? <Button size="small" onClick={() => openIssue(row)}>重试</Button> : null}{row.status === 0 || row.status === 1 ? <Button size="small" onClick={() => reconcile.mutate(row.id)}>对账</Button> : null}{row.transactionSignature ? <Button size="small" href={`/evidence/${row.transactionSignature}`}>核验</Button> : null}</Space>
        </article>)}
      </div>
    </AdminTablePanel>

    <Drawer title="存证办理回执" width={560} open={Boolean(selected)} onClose={() => setSelected(null)}>
      {selected ? <>
        <Descriptions bordered size="small" column={1} items={[
          { key: 'release', label: '存证对象', children: selected.subjectType === 'NOTE_CONTENT' ? `${selected.projectName} / ${selected.version} / ${selected.categoryName} / ${selected.noteTitle} / ${selected.contentVersion || '未命名版本'}` : `${selected.projectName} / ${selected.version}` },
          { key: 'hash', label: selected.subjectType === 'NOTE_CONTENT' ? '内容版本哈希' : '整版发布哈希', children: <Typography.Text copyable code>{selected.subjectHash}</Typography.Text> },
          { key: 'network', label: '网络可信级别', children: selected.network === 'mainnet' ? 'Mainnet · 正式存证' : 'Devnet · 测试凭证' },
          { key: 'wallet', label: '签名钱包', children: <Typography.Text copyable code>{selected.signerAddress}</Typography.Text> },
          { key: 'tx', label: '公开编号', children: selected.transactionSignature ? <Typography.Text copyable code>{selected.transactionSignature}</Typography.Text> : '尚未生成' },
        ]} />
        <Typography.Title level={5}>办理时间线</Typography.Title>
        <Timeline items={selected.attempts.map((attempt) => ({
          color: attempt.status === 2 ? 'green' : attempt.status === -1 ? 'red' : 'blue',
          children: <div><strong>{STATUS[attempt.status as keyof typeof STATUS]?.label || attempt.status}</strong><br /><Typography.Text type="secondary">{new Date(attempt.createdAt).toLocaleString()}</Typography.Text>{attempt.failureMessage ? <Alert type="error" showIcon message={attempt.failureCode || '办理失败'} description={attempt.failureMessage} /> : null}</div>,
        }))} />
        {selected.transactionSignature ? <Button block href={explorerUrl(selected.transactionSignature, selected.network)} target="_blank" icon={<ExternalLink size={14} />}>在 Solana Explorer 查看</Button> : null}
      </> : <Empty />}
    </Drawer>

    <Drawer title={retrySubject ? '重试存证' : '办理笔记内容版本存证'} width={620} open={issueOpen} destroyOnHidden onClose={() => {
      if (prepare.isPending || submit.isPending) return
      setIssueOpen(false)
      setRetrySubject(null)
      form.resetFields()
      void cancelPrepared('The evidence drawer was closed before signing')
    }}>
      <Alert showIcon type="info" message="发布与存证相互独立" description="新存证精确绑定已发布树中的一个笔记内容版本；该笔记的其他修订不会共享此凭证。" />
      {retrySubject ? <Alert showIcon type="warning" message="沿用原存证对象重试" description={retrySubject.subjectType === 'NOTE_CONTENT' ? `${retrySubject.projectName} / ${retrySubject.version} / ${retrySubject.noteTitle || '笔记'} / ${retrySubject.contentVersion || '未命名版本'}` : `${retrySubject.projectName} / ${retrySubject.version}（旧整版凭证）`} /> : null}
      {versionsQuery.isError || projectsQuery.isError ? <Alert showIcon type="error" message="可存证内容加载失败" description={evidenceErrorMessage(versionsQuery.error || projectsQuery.error)} /> : null}
      <Form form={form} layout="vertical" onFinish={(values) => prepare.mutate(values)}>
        {!retrySubject ? <>
          <Form.Item label="项目" required>
            <Select
              disabled={Boolean(prepared)}
              showSearch
              loading={projectsQuery.isLoading}
              optionFilterProp="label"
              value={issueProjectId || undefined}
              placeholder="选择项目"
              options={(projectsQuery.data?.list || []).map((item) => ({ value: item.id, label: item.projectName }))}
              onChange={(value) => {
                setIssueProjectId(value)
                setIssueVersionId('')
                setIssueCategoryId('')
                setIssueNoteId('')
                form.setFieldValue('noteContentId', undefined)
              }}
            />
          </Form.Item>
          <Form.Item label="已发布项目版本" required>
            <Select
              disabled={Boolean(prepared) || !issueProjectId}
              showSearch
              loading={versionsQuery.isLoading}
              optionFilterProp="label"
              value={issueVersionId || undefined}
              placeholder="选择已发布项目版本"
              options={(versionsQuery.data?.list || []).filter((item) => item.publishedAt).map((item) => ({ value: item.id, label: `${item.version} · ${item.releaseHash?.slice(0, 10) || '无哈希'}…` }))}
              onChange={(value) => {
                setIssueVersionId(value)
                setIssueCategoryId('')
                setIssueNoteId('')
                form.setFieldValue('noteContentId', undefined)
              }}
            />
          </Form.Item>
          <Form.Item label="分类" required>
            <Select
              disabled={Boolean(prepared) || !issueVersionId}
              showSearch
              loading={categoriesQuery.isLoading}
              optionFilterProp="label"
              value={issueCategoryId || undefined}
              placeholder="选择分类"
              options={(categoriesQuery.data?.list || []).map((item) => ({ value: item.id, label: item.categoryName }))}
              onChange={(value) => {
                setIssueCategoryId(value)
                setIssueNoteId('')
                form.setFieldValue('noteContentId', undefined)
              }}
            />
          </Form.Item>
          <Form.Item label="笔记" required>
            <Select
              disabled={Boolean(prepared) || !issueCategoryId}
              showSearch
              loading={notesQuery.isLoading}
              optionFilterProp="label"
              value={issueNoteId || undefined}
              placeholder="选择笔记"
              options={(notesQuery.data?.list || []).map((item) => ({ value: item.id, label: item.noteTitle }))}
              onChange={(value) => {
                setIssueNoteId(value)
                form.setFieldValue('noteContentId', undefined)
              }}
            />
          </Form.Item>
          <Form.Item name="noteContentId" label="内容版本" rules={[{ required: true }]}>
            <Select
              disabled={Boolean(prepared) || !issueNoteId}
              loading={contentsQuery.isLoading}
              placeholder="选择该笔记的内容版本"
              options={(contentsQuery.data?.list || []).filter((item) => !item.isDeleted).map((item) => ({
                value: Number(item.id),
                label: `${item.isPrimary ? '★ 主版本 · ' : ''}${item.versionNote || '未命名版本'} · ${item.status === 1 ? '启用' : '停用'}`,
              }))}
            />
          </Form.Item>
        </> : null}
        <Form.Item name="network" label="存证网络" rules={[{ required: true }]}>
          <Select disabled={Boolean(prepared)} options={(query.data?.networks || []).map((item) => ({ value: item.network, disabled: !item.enabled, label: `${item.network === 'mainnet' ? 'Mainnet · 正式存证' : 'Devnet · 测试凭证'}${item.enabled ? '' : '（已禁用）'}` }))} />
        </Form.Item>
        {prepared ? <Alert showIcon type="success" message="内容哈希、父级发布与钱包余额校验通过" description="请逐项核对以下回执内容。点击确认后才会打开钱包签名窗口。" /> : null}
        <Descriptions size="small" column={1} items={[
          { key: 'signer', label: '签名钱包 / Fee Payer', children: <Typography.Text code copyable>{prepared?.signerAddress || signer || '未连接'}</Typography.Text> },
          ...(prepared ? [
            { key: 'release', label: '来源层级', children: prepared.subjectType === 'NOTE_CONTENT' ? `${prepared.project} / ${prepared.version} / ${prepared.category} / ${prepared.note} / ${prepared.contentVersion || '未命名版本'}` : `${prepared.project} / ${prepared.version}` },
            { key: 'hash', label: prepared.subjectType === 'NOTE_CONTENT' ? '内容版本哈希' : '整版发布哈希', children: <Typography.Text code copyable>{prepared.releaseHash}</Typography.Text> },
            { key: 'network', label: '网络可信级别', children: prepared.network === 'mainnet' ? 'Mainnet · 正式存证（消耗真实 SOL）' : 'Devnet · 测试凭证' },
            { key: 'balance', label: '钱包余额', children: `${prepared.balanceLamports.toLocaleString()} lamports` },
            { key: 'fee', label: '预计费用', children: `${prepared.feeLamports.toLocaleString()} lamports` },
            { key: 'memo', label: '最终 Memo', children: <Typography.Text code copyable>{prepared.memo}</Typography.Text> },
          ] : []),
        ]} />
        {prepared && signer !== prepared.signerAddress ? <Alert showIcon type="warning" message="当前连接钱包已变化" description="为防止误签，请重新选择版本并生成待签交易。" /> : null}
        {prepared ? <Space direction="vertical" style={{ width: '100%' }}>
          <Button block type="primary" size="large" loading={submit.isPending} disabled={signer !== prepared.signerAddress} onClick={() => submit.mutate(prepared)}>确认回执内容并请求钱包签名</Button>
          <Button block disabled={submit.isPending} onClick={() => void cancelPrepared('The administrator chose to revise the prepared evidence')}>返回修改</Button>
        </Space> : <Button block type="primary" htmlType="submit" size="large" loading={prepare.isPending} disabled={!signer}>校验内容并生成待签交易</Button>}
      </Form>
    </Drawer>
  </AdminPage>
}
