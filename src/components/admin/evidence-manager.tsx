'use client'

/**
 * @file evidence-manager.tsx
 * @project SlothVault
 * @module Unified Evidence Administration
 * @description Provides one localized receipt ledger for legacy project-version and note-content evidence with cascaded content selection.
 * @logic Filter both evidence subjects, guide project-to-content signing for new records, safely map evidence failures to current-language messages, and retain subject-aware retry and reconciliation beside each attempt timeline.
 * @dependencies React Query, Ant Design, next-intl, use-solana-wallet, release evidence APIs, admin localization utilities
 * @index_tags admin,evidence,solana,wallet,receipts,reconciliation,i18n,error-handling
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
import { useLocale, useTranslations } from 'next-intl'

import { AdminPage, AdminPageActions, AdminTablePanel, AdminToolbar } from '@/components/admin/admin-page'
import { useSolanaWallet } from '@/components/wallet/use-solana-wallet'
import { formatAdminDate, formatAdminError, formatAdminNumber } from '@/lib/admin-localization'
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
  [-1]: { labelKey: 'status.failed', color: 'error', icon: <CircleAlert size={14} /> },
  [0]: { labelKey: 'status.awaitingSignature', color: 'default', icon: <FileSignature size={14} /> },
  [1]: { labelKey: 'status.confirming', color: 'processing', icon: <Clock3 size={14} /> },
  [2]: { labelKey: 'status.finalized', color: 'success', icon: <BadgeCheck size={14} /> },
} as const

type EvidenceUiErrorCode = 'walletNotConnected' | 'walletChanged' | 'mainnetSignatureCancelled'

class EvidenceUiError extends Error {
  constructor(readonly displayCode: EvidenceUiErrorCode) {
    super(displayCode)
    this.name = 'EvidenceUiError'
  }
}

function compact(value: string | null, head = 9, tail = 7) {
  if (!value) return '—'
  return value.length > head + tail ? `${value.slice(0, head)}…${value.slice(-tail)}` : value
}

function explorerUrl(signature: string, network: Network) {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${network === 'devnet' ? '?cluster=devnet' : ''}`
}

export function EvidenceManager() {
  const t = useTranslations('AdminMM.evidenceManager')
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
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
  const statusMeta = (value: number) => STATUS[value as keyof typeof STATUS]
  const statusLabel = (value: number) => {
    const entry = statusMeta(value)
    return entry ? t(entry.labelKey) : t('status.unknown')
  }
  const networkLabel = (value: Network, withCost = false) => {
    if (value === 'mainnet') return t(withCost ? 'network.mainnetWithCost' : 'network.mainnet')
    return t('network.devnet')
  }
  const evidenceErrorMessage = (error: unknown) => {
    const reason = error instanceof ApiClientError && error.data && typeof error.data === 'object' && 'reason' in error.data
      ? String(error.data.reason)
      : ''
    if (reason === 'EVIDENCE_BALANCE_INSUFFICIENT') return errorT('walletInsufficient')
    if (reason === 'EVIDENCE_NETWORK_DISABLED') return t('messages.networkDisabled')
    if (reason === 'RELEASE_INTEGRITY_FAILED') return t('messages.integrityFailed')
    if (error instanceof EvidenceUiError && error.displayCode === 'walletNotConnected') return t('messages.selectWallet')
    if (error instanceof EvidenceUiError && error.displayCode === 'walletChanged') return t('messages.walletChanged')
    if (error instanceof EvidenceUiError && error.displayCode === 'mainnetSignatureCancelled') return t('messages.mainnetCancelled')
    if (error instanceof ApiClientError && error.status === 503) return errorT('rpcUnavailable')
    return formatAdminError(error, errorT)
  }

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
    onSuccess: async () => { message.success(t('messages.reconciled')); await refresh() },
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
      if (!signer) throw new EvidenceUiError('walletNotConnected')
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
        throw new EvidenceUiError('walletChanged')
      }
      let signedTransactionBase64: string
      try {
        if (next.network === 'mainnet') {
          await new Promise<void>((resolve, reject) => modal.confirm({
            title: t('drawer.mainnetConfirmTitle'),
            content: t('drawer.mainnetConfirmDescription', { fee: (next.feeLamports / 1_000_000_000).toFixed(9) }),
            okText: t('drawer.mainnetConfirm'),
            okButtonProps: { danger: true },
            onOk: resolve,
            onCancel: () => reject(new EvidenceUiError('mainnetSignatureCancelled')),
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
      message.success(t('messages.submitted'))
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
    }).catch(() => message.warning(t('messages.cancelPending')))
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
      title: t('table.subject'),
      render: (_, row) => <div>
        <Space size={5}><strong>{row.projectName}</strong><Tag bordered={false}>{row.subjectType === 'NOTE_CONTENT' ? t('subject.noteContent') : t('subject.projectVersion')}</Tag></Space>
        <br />
        <Typography.Text type="secondary">
          {row.subjectType === 'NOTE_CONTENT'
            ? `${row.version} / ${row.categoryName || t('table.emptyTransaction')} / ${row.noteTitle || t('table.emptyTransaction')} / ${row.contentVersion || t('subject.unnamedVersion')}`
            : row.version}
        </Typography.Text>
      </div>,
    },
    {
      title: t('table.network'), width: 115, render: (_, row) => row.network === 'devnet'
        ? <Tag icon={<FlaskConical size={12} />} color="warning">{t('network.devnetCredential')}</Tag>
        : <Tag icon={<BadgeCheck size={12} />} color="success">{t('network.mainnetCredential')}</Tag>,
    },
    { title: t('table.status'), width: 105, render: (_, row) => <Tag color={statusMeta(row.status)?.color} icon={statusMeta(row.status)?.icon}>{statusLabel(row.status)}</Tag> },
    { title: t('table.transaction'), width: 190, render: (_, row) => row.transactionSignature ? <Tooltip title={row.transactionSignature}><code>{compact(row.transactionSignature)}</code></Tooltip> : t('table.emptyTransaction') },
    {
      title: t('table.actions'), width: 170, fixed: 'right', render: (_, row) => <Space size={2}>
        <Button type="link" onClick={() => setSelected(row)}>{t('actions.details')}</Button>
        {row.status === -1 ? <Button type="link" onClick={() => openIssue(row)}>{t('actions.retry')}</Button> : null}
        {row.status === 0 || row.status === 1 ? <Button type="link" loading={reconcile.isPending} onClick={() => reconcile.mutate(row.id)}>{t('actions.reconcile')}</Button> : null}
        {row.transactionSignature ? <Button type="link" href={`/evidence/${row.transactionSignature}`} target="_blank">{t('actions.verify')}</Button> : null}
      </Space>,
    },
  ]

  return <AdminPage>
    <AdminPageActions>
      <Space wrap>
        <Button icon={<RefreshCw size={15} />} loading={query.isFetching} onClick={() => void query.refetch()}>{t('actions.refresh')}</Button>
        <Button type="primary" icon={<FileSignature size={15} />} onClick={() => openIssue()}>{t('actions.issue')}</Button>
      </Space>
    </AdminPageActions>

    <AdminToolbar className="evidence-toolbar">
      <div className="evidence-toolbar-primary">
        <div className="evidence-toolbar-heading">
          <Typography.Text strong>{t('toolbar.ledger')}</Typography.Text>
          <Typography.Text type="secondary">{t('toolbar.recordCount', { count: formatAdminNumber(locale, query.data?.total || 0) })}</Typography.Text>
        </div>
        <Segmented options={[{ label: t('toolbar.all'), value: 'all' }, { label: t('toolbar.myWallet'), value: 'wallet', icon: <WalletCards size={14} /> }]} value={scope} onChange={(value) => { setScope(value as 'all' | 'wallet'); setPage(1) }} />
      </div>
      <Space className="evidence-toolbar-filters" wrap>
          <Select allowClear placeholder={t('toolbar.subjectType')} value={subjectType} onChange={(value) => { setSubjectType(value); setPage(1) }} options={[{ value: 'NOTE_CONTENT', label: t('subject.noteContent') }, { value: 'PROJECT_VERSION', label: t('subject.legacyProjectVersion') }]} />
          <Select allowClear placeholder={t('network.label')} value={network} onChange={(value) => { setNetwork(value); setPage(1) }} options={[{ value: 'mainnet', label: t('network.mainnet') }, { value: 'devnet', label: t('network.devnet') }]} />
          <Select allowClear placeholder={t('toolbar.status')} value={status} onChange={(value) => { setStatus(value); setPage(1) }} options={Object.keys(STATUS).map((value) => ({ value: Number(value), label: statusLabel(Number(value)) }))} />
          <Input allowClear prefix={<Search size={14} />} placeholder={t('toolbar.transaction')} value={signature} onChange={(event) => { setSignature(event.target.value); setPage(1) }} />
      </Space>
    </AdminToolbar>
    <AdminTablePanel className="evidence-ledger">
      {query.isError ? <Alert showIcon type="error" message={t('messages.loadFailed')} description={evidenceErrorMessage(query.error)} action={<Button size="small" onClick={() => void query.refetch()}>{t('actions.retryLoad')}</Button>} /> : null}
      {scope === 'wallet' && !signer ? <Alert showIcon type="info" message={t('messages.walletScope')} /> : null}
      <Table rowKey="id" size="small" loading={query.isLoading} dataSource={query.data?.list || []} columns={columns} scroll={{ x: 1080 }} pagination={{ current: page, pageSize: 20, total: query.data?.total || 0, showSizeChanger: false, onChange: setPage }} />
      <div className="evidence-mobile-list">
        {!query.isLoading && (query.data?.list.length || 0) === 0 ? <Empty description={t('messages.empty')} /> : null}
        {(query.data?.list || []).map((row) => <article className="evidence-mobile-card" key={row.id}>
          <div><strong>{row.subjectType === 'NOTE_CONTENT' ? `${row.noteTitle || t('subject.noteFallback')} / ${row.contentVersion || t('subject.unnamedVersion')}` : `${row.projectName} / ${row.version}`}</strong><Tag color={row.network === 'devnet' ? 'warning' : 'success'}>{row.network === 'devnet' ? t('network.devnetCredential') : t('network.mainnetCredential')}</Tag></div>
          <code title={row.subjectHash || ''}>{compact(row.subjectHash, 14, 10)}</code>
          <Space><Tag color={statusMeta(row.status)?.color}>{statusLabel(row.status)}</Tag><Typography.Text type="secondary">{compact(row.signerAddress)}</Typography.Text></Space>
          <Space><Button size="small" onClick={() => setSelected(row)}>{t('actions.details')}</Button>{row.status === -1 ? <Button size="small" onClick={() => openIssue(row)}>{t('actions.retry')}</Button> : null}{row.status === 0 || row.status === 1 ? <Button size="small" onClick={() => reconcile.mutate(row.id)}>{t('actions.reconcile')}</Button> : null}{row.transactionSignature ? <Button size="small" href={`/evidence/${row.transactionSignature}`}>{t('actions.verify')}</Button> : null}</Space>
        </article>)}
      </div>
    </AdminTablePanel>

    <Drawer title={t('receipt.title')} width={560} open={Boolean(selected)} onClose={() => setSelected(null)}>
      {selected ? <>
        <Descriptions bordered size="small" column={1} items={[
          { key: 'release', label: t('receipt.subject'), children: selected.subjectType === 'NOTE_CONTENT' ? `${selected.projectName} / ${selected.version} / ${selected.categoryName || t('table.emptyTransaction')} / ${selected.noteTitle || t('subject.noteFallback')} / ${selected.contentVersion || t('subject.unnamedVersion')}` : `${selected.projectName} / ${selected.version}` },
          { key: 'hash', label: selected.subjectType === 'NOTE_CONTENT' ? t('receipt.contentHash') : t('receipt.releaseHash'), children: <Typography.Text copyable code>{selected.subjectHash}</Typography.Text> },
          { key: 'network', label: t('receipt.networkTrust'), children: networkLabel(selected.network) },
          { key: 'wallet', label: t('receipt.wallet'), children: <Typography.Text copyable code>{selected.signerAddress}</Typography.Text> },
          { key: 'tx', label: t('receipt.transaction'), children: selected.transactionSignature ? <Typography.Text copyable code>{selected.transactionSignature}</Typography.Text> : t('receipt.notGenerated') },
        ]} />
        <Typography.Title level={5}>{t('receipt.timeline')}</Typography.Title>
        <Timeline items={selected.attempts.map((attempt) => ({
          color: attempt.status === 2 ? 'green' : attempt.status === -1 ? 'red' : 'blue',
          children: <div><strong>{statusLabel(attempt.status)}</strong><br /><Typography.Text type="secondary">{formatAdminDate(locale, attempt.createdAt)}</Typography.Text>{attempt.failureMessage ? <Alert type="error" showIcon message={t('messages.failure')} description={evidenceErrorMessage(new ApiClientError('Evidence attempt failed', 400, 400, { reason: attempt.failureCode }))} /> : null}</div>,
        }))} />
        {selected.transactionSignature ? <Button block href={explorerUrl(selected.transactionSignature, selected.network)} target="_blank" icon={<ExternalLink size={14} />}>{t('actions.openExplorer')}</Button> : null}
      </> : <Empty />}
    </Drawer>

    <Drawer title={retrySubject ? t('drawer.retryTitle') : t('drawer.issueTitle')} width={620} open={issueOpen} destroyOnHidden onClose={() => {
      if (prepare.isPending || submit.isPending) return
      setIssueOpen(false)
      setRetrySubject(null)
      form.resetFields()
      void cancelPrepared('The evidence drawer was closed before signing')
    }}>
      <Alert showIcon type="info" message={t('drawer.independentTitle')} description={t('drawer.independentDescription')} />
      {retrySubject ? <Alert showIcon type="warning" message={t('drawer.retryTitleAlert')} description={retrySubject.subjectType === 'NOTE_CONTENT' ? `${retrySubject.projectName} / ${retrySubject.version} / ${retrySubject.noteTitle || t('subject.noteFallback')} / ${retrySubject.contentVersion || t('subject.unnamedVersion')}` : t('drawer.legacyRetry', { project: retrySubject.projectName, version: retrySubject.version })} /> : null}
      {versionsQuery.isError || projectsQuery.isError ? <Alert showIcon type="error" message={t('drawer.loadOptionsFailed')} description={evidenceErrorMessage(versionsQuery.error || projectsQuery.error)} /> : null}
      <Form form={form} layout="vertical" onFinish={(values) => prepare.mutate(values)}>
        {!retrySubject ? <>
          <Form.Item label={t('drawer.project')} required>
            <Select
              disabled={Boolean(prepared)}
              showSearch
              loading={projectsQuery.isLoading}
              optionFilterProp="label"
              value={issueProjectId || undefined}
              placeholder={t('drawer.selectProject')}
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
          <Form.Item label={t('drawer.publishedVersion')} required>
            <Select
              disabled={Boolean(prepared) || !issueProjectId}
              showSearch
              loading={versionsQuery.isLoading}
              optionFilterProp="label"
              value={issueVersionId || undefined}
              placeholder={t('drawer.selectPublishedVersion')}
              options={(versionsQuery.data?.list || []).filter((item) => item.publishedAt).map((item) => ({ value: item.id, label: `${item.version} · ${item.releaseHash?.slice(0, 10) || t('subject.noHash')}…` }))}
              onChange={(value) => {
                setIssueVersionId(value)
                setIssueCategoryId('')
                setIssueNoteId('')
                form.setFieldValue('noteContentId', undefined)
              }}
            />
          </Form.Item>
          <Form.Item label={t('drawer.category')} required>
            <Select
              disabled={Boolean(prepared) || !issueVersionId}
              showSearch
              loading={categoriesQuery.isLoading}
              optionFilterProp="label"
              value={issueCategoryId || undefined}
              placeholder={t('drawer.selectCategory')}
              options={(categoriesQuery.data?.list || []).map((item) => ({ value: item.id, label: item.categoryName }))}
              onChange={(value) => {
                setIssueCategoryId(value)
                setIssueNoteId('')
                form.setFieldValue('noteContentId', undefined)
              }}
            />
          </Form.Item>
          <Form.Item label={t('drawer.note')} required>
            <Select
              disabled={Boolean(prepared) || !issueCategoryId}
              showSearch
              loading={notesQuery.isLoading}
              optionFilterProp="label"
              value={issueNoteId || undefined}
              placeholder={t('drawer.selectNote')}
              options={(notesQuery.data?.list || []).map((item) => ({ value: item.id, label: item.noteTitle }))}
              onChange={(value) => {
                setIssueNoteId(value)
                form.setFieldValue('noteContentId', undefined)
              }}
            />
          </Form.Item>
          <Form.Item name="noteContentId" label={t('drawer.contentVersion')} rules={[{ required: true }]}>
            <Select
              disabled={Boolean(prepared) || !issueNoteId}
              loading={contentsQuery.isLoading}
              placeholder={t('drawer.selectContentVersion')}
              options={(contentsQuery.data?.list || []).filter((item) => !item.isDeleted).map((item) => ({
                value: Number(item.id),
                label: `${item.isPrimary ? t('subject.primaryVersion') : ''}${item.versionNote || t('subject.unnamedVersion')} · ${item.status === 1 ? t('contentStatus.enabled') : t('contentStatus.disabled')}`,
              }))}
            />
          </Form.Item>
        </> : null}
        <Form.Item name="network" label={t('drawer.network')} rules={[{ required: true }]}>
          <Select disabled={Boolean(prepared)} options={(query.data?.networks || []).map((item) => ({ value: item.network, disabled: !item.enabled, label: `${networkLabel(item.network)}${item.enabled ? '' : t('network.disabled')}` }))} />
        </Form.Item>
        {prepared ? <Alert showIcon type="success" message={t('drawer.preparedTitle')} description={t('drawer.preparedDescription')} /> : null}
        <Descriptions size="small" column={1} items={[
          { key: 'signer', label: t('drawer.signer'), children: <Typography.Text code copyable>{prepared?.signerAddress || signer || t('drawer.notConnected')}</Typography.Text> },
          ...(prepared ? [
            { key: 'release', label: t('drawer.source'), children: prepared.subjectType === 'NOTE_CONTENT' ? `${prepared.project} / ${prepared.version} / ${prepared.category || t('table.emptyTransaction')} / ${prepared.note || t('subject.noteFallback')} / ${prepared.contentVersion || t('subject.unnamedVersion')}` : `${prepared.project} / ${prepared.version}` },
            { key: 'hash', label: prepared.subjectType === 'NOTE_CONTENT' ? t('receipt.contentHash') : t('receipt.releaseHash'), children: <Typography.Text code copyable>{prepared.releaseHash}</Typography.Text> },
            { key: 'network', label: t('receipt.networkTrust'), children: networkLabel(prepared.network, true) },
            { key: 'balance', label: t('drawer.balance'), children: t('units.lamports', { value: formatAdminNumber(locale, prepared.balanceLamports) }) },
            { key: 'fee', label: t('drawer.estimatedFee'), children: t('units.lamports', { value: formatAdminNumber(locale, prepared.feeLamports) }) },
            { key: 'memo', label: t('drawer.finalMemo'), children: <Typography.Text code copyable>{prepared.memo}</Typography.Text> },
          ] : []),
        ]} />
        {prepared && signer !== prepared.signerAddress ? <Alert showIcon type="warning" message={t('drawer.walletChangedTitle')} description={t('drawer.walletChangedDescription')} /> : null}
        {prepared ? <Space direction="vertical" style={{ width: '100%' }}>
          <Button block type="primary" size="large" loading={submit.isPending} disabled={signer !== prepared.signerAddress} onClick={() => submit.mutate(prepared)}>{t('actions.sign')}</Button>
          <Button block disabled={submit.isPending} onClick={() => void cancelPrepared('The administrator chose to revise the prepared evidence')}>{t('actions.backToEdit')}</Button>
        </Space> : <Button block type="primary" htmlType="submit" size="large" loading={prepare.isPending} disabled={!signer}>{t('actions.prepare')}</Button>}
      </Form>
    </Drawer>
  </AdminPage>
}
