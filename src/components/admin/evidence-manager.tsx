'use client'

/**
 * @file evidence-manager.tsx
 * @project SlothVault
 * @module Unified Evidence Administration
 * @description Provides one localized receipt ledger for project-version evidence with publication selection.
 * @logic Restrict Devnet to Phantom, retain signed bytes for uncertain submissions, display expired attempts and precise failures, and refresh both ledger and receipt during reconciliation.
 * @dependencies React Query, Ant Design, next-intl, use-solana-wallet, release evidence APIs, admin localization utilities
 * @index_tags admin,evidence,solana,wallet,receipts,reconciliation,i18n,error-handling
 * @author holic512
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

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
import { EvidenceSubmissionCache, evidenceRequest } from '@/lib/evidence-client'
import { evidenceReason, EvidenceSigningError, isExpiredEvidenceAttempt } from '@/lib/evidence-diagnostics'

type Network = 'mainnet' | 'devnet'
type SubjectType = 'PROJECT_VERSION'
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
  projectId: string
  projectName: string
  version: string
  noteId: string | null
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
  manifestVersion: number | null
  project: { id: string; projectName: string } | null
}
type ProjectOption = { id: string; projectName: string }
type Prepared = {
  credentialId: string
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
  releaseHash: string
  network: Network
  walletName: string | null
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

const subscribeHydration = () => () => {}
const clientHydrationSnapshot = () => true
const serverHydrationSnapshot = () => false

export function EvidenceManager() {
  // Keep the form mounted after hydration without opening an SSR Portal.
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrationSnapshot, serverHydrationSnapshot)
  const t = useTranslations('AdminMM.evidenceManager')
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const wallet = useSolanaWallet()
  const [scope, setScope] = useState<'all' | 'wallet'>('all')
  const [network, setNetwork] = useState<Network | undefined>()
  const [status, setStatus] = useState<number | undefined>()
  const [signature, setSignature] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [issueOpen, setIssueOpen] = useState(false)
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [retrySubject, setRetrySubject] = useState<Evidence | null>(null)
  const [issueProjectId, setIssueProjectId] = useState('')
  const [form] = Form.useForm<{ projectVersionId: number; network: Network }>()
  const issueNetwork = Form.useWatch('network', form)
  const signedCache = useRef(new EvidenceSubmissionCache())
  const [submissionUncertain, setSubmissionUncertain] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const devnetEligible = wallet.canSignForNetwork('devnet')
  const mainnetEligible = wallet.canSignForNetwork('mainnet')
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
    const reason = evidenceReason(error)
    const specific = {
      EVIDENCE_PHANTOM_REQUIRED: 'phantomRequired', EVIDENCE_WALLET_UNSUPPORTED: 'walletUnsupported',
      EVIDENCE_WALLET_CHANGED: 'walletChanged', EVIDENCE_WALLET_SIGNATURE_REJECTED: 'signatureRejected',
      EVIDENCE_MESSAGE_MISMATCH: 'messageMismatch', EVIDENCE_SIGNATURE_INVALID: 'signatureInvalid',
      EVIDENCE_TRANSACTION_INVALID: 'transactionInvalid', EVIDENCE_STRUCTURE_INVALID: 'transactionInvalid',
      EVIDENCE_PREPARE_EXPIRED: 'expired', PREPARE_EXPIRED: 'expired', EVIDENCE_ATTEMPT_STALE: 'attemptStale',
      EVIDENCE_ATTEMPT_FAILED: 'attemptFailed', EVIDENCE_ALREADY_SUBMITTED: 'alreadySubmitted',
      EVIDENCE_ALREADY_FINALIZED: 'alreadyFinalized', EVIDENCE_PREPARE_ACTIVE: 'prepareActive',
      WALLET_SIGNATURE_CANCELLED: 'signatureRejected', CHAIN_SUBMISSION_FAILED: 'chainFailed',
      BLOCKHASH_EXPIRED: 'blockhashExpired', CHAIN_TRANSACTION_FAILED: 'chainFailed', CHAIN_EVIDENCE_MISMATCH: 'messageMismatch',
      CHAIN_COMPUTE_BUDGET_EXCEEDED: 'computeBudgetExceeded', CHAIN_BLOCKHASH_UNAVAILABLE: 'submissionUnknown', EVIDENCE_BALANCE_INSUFFICIENT: 'balanceInsufficient',
    } as const
    if (reason in specific) return t(`messages.${specific[reason as keyof typeof specific]}`)
    if (reason === 'EVIDENCE_TOO_LARGE') return t('messages.tooLarge')
    if (reason === 'EVIDENCE_NETWORK_DISABLED') return t('messages.networkDisabled')
    if (reason === 'RELEASE_INTEGRITY_FAILED') return t('messages.integrityFailed')
    if (error instanceof EvidenceUiError && error.displayCode === 'walletNotConnected') return t('messages.selectWallet')
    if (error instanceof EvidenceUiError && error.displayCode === 'walletChanged') return t('messages.walletChanged')
    if (error instanceof EvidenceUiError && error.displayCode === 'mainnetSignatureCancelled') return t('messages.mainnetCancelled')
    if (error instanceof ApiClientError && error.status === 503) return errorT('rpcUnavailable')
    return formatAdminError(error, errorT)
  }

  const query = useQuery({
    queryKey: ['release-evidence', scope, signer, network, status, signature, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' })
      if (scope === 'wallet' && signer) params.set('signerAddress', signer)
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
  const selected = query.data?.list.find((item) => item.id === selectedId) ?? null
  const expired = (row: Evidence) => row.status === 0 && !row.transactionSignature && Boolean(row.attempts[0] && isExpiredEvidenceAttempt(row.attempts[0], now))
  const rowStatusLabel = (row: Evidence) => expired(row) ? t('status.expired') : statusLabel(row.status)
  const versionsQuery = useQuery({
    queryKey: ['published-versions-for-evidence', issueProjectId],
    enabled: issueOpen && !retrySubject && Boolean(issueProjectId),
    queryFn: () => apiFetch<{ list: PublishedVersion[] }>(`/api/admin/mm/projectVersion/byProject/${issueProjectId}?pageSize=100&orderBy=publishedAt&order=desc`),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['release-evidence'] })
  const reconcile = useMutation({
    mutationFn: (id: string) => evidenceRequest<{ status: number }>(`/api/admin/evidence/${id}/reconcile`, {}, { credentialId: id }, 'reconcile'),
    onSuccess: async (result, id) => {
      if (prepared?.credentialId === id && result.status !== 0) {
        signedCache.current.clear(); setPrepared(null); setSubmissionUncertain(false)
      }
      message.success(t('messages.reconciled')); await refresh()
    },
    onError: (error) => message.error(evidenceErrorMessage(error)),
  })
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!hydrated) return
    const value = form.getFieldValue('network')
    if (!prepared && ((value === 'devnet' && !devnetEligible) || (value === 'mainnet' && !mainnetEligible))) {
      form.setFieldValue('network', undefined)
    }
  }, [form, prepared, devnetEligible, mainnetEligible, hydrated])

  const prepare = useMutation({
    mutationFn: async (values: { projectVersionId: number; network: Network }) => {
      if (!signer) throw new EvidenceUiError('walletNotConnected')
      wallet.assertEvidenceNetwork(values.network)
      const subject = retrySubject
        ? { type: 'projectVersion' as const, projectVersionId: Number(retrySubject.projectVersionId) }
        : { type: 'projectVersion' as const, projectVersionId: values.projectVersionId }
      const walletName = wallet.walletName
      const next = await evidenceRequest<Prepared>('/api/admin/evidence/prepare',
        { subject, network: values.network, signerAddress: signer }, { network: values.network, walletName }, 'prepare')
      return { ...next, walletName }
    },
    onSuccess: async (next) => { setPrepared(next); await refresh() },
    onError: (error) => message.error(evidenceErrorMessage(error)),
  })
  const submit = useMutation({
    mutationFn: async (next: Prepared) => {
      if (!signer || signer !== next.signerAddress || (!signedCache.current.pending && wallet.walletName !== next.walletName)) {
        throw new EvidenceUiError('walletChanged')
      }
      wallet.assertEvidenceNetwork(next.network)
      const signedTransactionBase64 = await signedCache.current.payload(next.attemptId, async () => {
        try {
          if (next.expiresAt <= Date.now()) throw new EvidenceSigningError('EVIDENCE_PREPARE_EXPIRED')
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
          return await wallet.signPreparedTransaction(next.transactionBase64, next.network, next.attemptId)
        } catch (error) {
          await apiFetch(`/api/admin/evidence/attempts/${next.attemptId}/cancel`, {
            method: 'POST',
            body: JSON.stringify({ reason: evidenceReason(error) }),
          }).catch(() => undefined)
          setPrepared(null)
          throw error
        }
      })
      return evidenceRequest<{ status: number }>('/api/admin/evidence/submit',
        { attemptId: next.attemptId, signedTransactionBase64 },
        { attemptId: next.attemptId, network: next.network, walletName: next.walletName }, 'submit')
    },
    onSuccess: async (result) => {
      signedCache.current.clear()
      setSubmissionUncertain(false)
      if (result.status === 2) message.success(t('messages.finalized'))
      else if (result.status === -1) message.error(t('messages.chainFailed'))
      else message.success(t('messages.submitted'))
      setIssueOpen(false)
      setPrepared(null)
      setRetrySubject(null)
      form.resetFields()
      await refresh()
    },
    onError: async (error) => {
      if (signedCache.current.settleError(error)) setPrepared(null)
      setSubmissionUncertain(signedCache.current.pending)
      message.error(evidenceErrorMessage(error))
      await refresh()
    },
  })

  const cancelPrepared = async (reason: string) => {
    if (signedCache.current.pending) { message.warning(t('messages.submissionUnknown')); return }
    const current = prepared
    setPrepared(null)
    if (!current) return
    await apiFetch(`/api/admin/evidence/attempts/${current.attemptId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }).catch(() => message.warning(t('messages.cancelPending')))
  }

  const openIssue = (row?: Evidence) => {
    if (prepared || signedCache.current.pending) { setIssueOpen(true); return }
    setRetrySubject(row || null)
    form.setFieldsValue({
      projectVersionId: row?.projectVersionId ? Number(row.projectVersionId) : undefined,
      network: (() => {
        const candidate = row?.network ?? query.data?.defaultNetwork ?? 'devnet'
        return wallet.canSignForNetwork(candidate) && query.data?.networks.some((item) => item.network === candidate && item.enabled) ? candidate : undefined
      })(),
    })
    setIssueProjectId('')
    setPrepared(null)
    setIssueOpen(true)
  }

  const columns: ColumnsType<Evidence> = [
    {
      title: t('table.subject'),
      render: (_, row) => <div>
        <Space size={5}><strong>{row.projectName}</strong><Tag variant="filled">{t('subject.projectVersion')}</Tag></Space>
        <br />
        <Typography.Text type="secondary">
          {row.version}
        </Typography.Text>
      </div>,
    },
    {
      title: t('table.network'), width: 115, render: (_, row) => row.network === 'devnet'
        ? <Tag icon={<FlaskConical size={12} />} color="warning">{t('network.devnetCredential')}</Tag>
        : <Tag icon={<BadgeCheck size={12} />} color="success">{t('network.mainnetCredential')}</Tag>,
    },
    { title: t('table.status'), width: 105, render: (_, row) => <Tag color={statusMeta(row.status)?.color} icon={statusMeta(row.status)?.icon}>{rowStatusLabel(row)}</Tag> },
    { title: t('table.transaction'), width: 190, render: (_, row) => row.transactionSignature ? <Tooltip title={row.transactionSignature}><code>{compact(row.transactionSignature)}</code></Tooltip> : t('table.emptyTransaction') },
    {
      title: t('table.actions'), width: 170, fixed: 'right', render: (_, row) => <Space size={2}>
        <Button type="link" onClick={() => setSelectedId(row.id)}>{t('actions.details')}</Button>
        {(row.status === -1 || expired(row)) ? <Button type="link" onClick={() => openIssue(row)}>{t('actions.retry')}</Button> : null}
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
          <Select allowClear placeholder={t('network.label')} value={network} onChange={(value) => { setNetwork(value); setPage(1) }} options={[{ value: 'mainnet', label: t('network.mainnet') }, { value: 'devnet', label: t('network.devnet') }]} />
          <Select allowClear placeholder={t('toolbar.status')} value={status} onChange={(value) => { setStatus(value); setPage(1) }} options={Object.keys(STATUS).map((value) => ({ value: Number(value), label: statusLabel(Number(value)) }))} />
          <Input allowClear prefix={<Search size={14} />} placeholder={t('toolbar.transaction')} value={signature} onChange={(event) => { setSignature(event.target.value); setPage(1) }} />
      </Space>
    </AdminToolbar>
    <AdminTablePanel className="evidence-ledger">
      {query.isError ? <Alert showIcon type="error" title={t('messages.loadFailed')} description={evidenceErrorMessage(query.error)} action={<Button size="small" onClick={() => void query.refetch()}>{t('actions.retryLoad')}</Button>} /> : null}
      {scope === 'wallet' && !signer ? <Alert showIcon type="info" title={t('messages.walletScope')} /> : null}
      <Table rowKey="id" size="small" loading={query.isLoading} dataSource={query.data?.list || []} columns={columns} scroll={{ x: 1080 }} pagination={{ current: page, pageSize: 20, total: query.data?.total || 0, showSizeChanger: false, onChange: setPage }} />
      <div className="evidence-mobile-list">
        {!query.isLoading && (query.data?.list.length || 0) === 0 ? <Empty description={t('messages.empty')} /> : null}
        {(query.data?.list || []).map((row) => <article className="evidence-mobile-card" key={row.id}>
          <div><strong>{`${row.projectName} / ${row.version}`}</strong><Tag color={row.network === 'devnet' ? 'warning' : 'success'}>{row.network === 'devnet' ? t('network.devnetCredential') : t('network.mainnetCredential')}</Tag></div>
          <code title={row.subjectHash || ''}>{compact(row.subjectHash, 14, 10)}</code>
          <Space><Tag color={statusMeta(row.status)?.color}>{rowStatusLabel(row)}</Tag><Typography.Text type="secondary">{compact(row.signerAddress)}</Typography.Text></Space>
          <Space><Button size="small" onClick={() => setSelectedId(row.id)}>{t('actions.details')}</Button>{(row.status === -1 || expired(row)) ? <Button size="small" onClick={() => openIssue(row)}>{t('actions.retry')}</Button> : null}{row.status === 0 || row.status === 1 ? <Button size="small" onClick={() => reconcile.mutate(row.id)}>{t('actions.reconcile')}</Button> : null}{row.transactionSignature ? <Button size="small" href={`/evidence/${row.transactionSignature}`}>{t('actions.verify')}</Button> : null}</Space>
        </article>)}
      </div>
    </AdminTablePanel>

    <Drawer title={t('receipt.title')} size={560} open={Boolean(selected)} onClose={() => setSelectedId(null)}>
      {selected ? <>
        <Descriptions bordered size="small" column={1} items={[
          { key: 'release', label: t('receipt.subject'), children: `${selected.projectName} / ${selected.version}` },
          { key: 'hash', label: t('receipt.contentHash'), children: <Typography.Text copyable code>{selected.subjectHash}</Typography.Text> },
          { key: 'network', label: t('receipt.networkTrust'), children: networkLabel(selected.network) },
          { key: 'wallet', label: t('receipt.wallet'), children: <Typography.Text copyable code>{selected.signerAddress}</Typography.Text> },
          { key: 'tx', label: t('receipt.transaction'), children: selected.transactionSignature ? <Typography.Text copyable code>{selected.transactionSignature}</Typography.Text> : t('receipt.notGenerated') },
        ]} />
        <Typography.Title level={5}>{t('receipt.timeline')}</Typography.Title>
        <Timeline items={selected.attempts.map((attempt) => ({
          color: attempt.status === 2 ? 'green' : attempt.status === -1 ? 'red' : 'blue',
          content: <div><strong>{isExpiredEvidenceAttempt(attempt, now) ? t('status.expired') : statusLabel(attempt.status)}</strong><br /><Typography.Text type="secondary">{formatAdminDate(locale, attempt.createdAt)}</Typography.Text>{attempt.failureMessage ? <Alert type="error" showIcon title={t('messages.failure')} description={evidenceErrorMessage(new ApiClientError('Evidence attempt failed', 400, 400, { reason: attempt.failureCode }))} /> : null}</div>,
        }))} />
        {selected.transactionSignature ? <Button block href={explorerUrl(selected.transactionSignature, selected.network)} target="_blank" icon={<ExternalLink size={14} />}>{t('actions.openExplorer')}</Button> : null}
      </> : <Empty />}
    </Drawer>

    <Drawer title={retrySubject ? t('drawer.retryTitle') : t('drawer.issueTitle')} size={620} open={issueOpen} forceRender={hydrated} onClose={() => {
      if (prepare.isPending || submit.isPending) return
      setIssueOpen(false)
      if (signedCache.current.pending) return
      setRetrySubject(null)
      form.resetFields()
      void cancelPrepared('The evidence drawer was closed before signing')
    }}>
      <Alert showIcon type="info" title={t('drawer.independentTitle')} description={t('drawer.independentDescription')} />
      {retrySubject ? <Alert showIcon type="warning" title={t('drawer.retryTitleAlert')} description={`${retrySubject.projectName} / ${retrySubject.version}`} /> : null}
      {versionsQuery.isError || projectsQuery.isError ? <Alert showIcon type="error" title={t('drawer.loadOptionsFailed')} description={evidenceErrorMessage(versionsQuery.error || projectsQuery.error)} /> : null}
      {wallet.walletName && wallet.walletName !== 'Phantom' ? <Alert showIcon type="warning" title={t('messages.phantomRequired')} /> : null}
      {prepared && submissionUncertain ? <Alert showIcon type="warning" title={t('messages.submissionUnknown')} action={<Button onClick={() => reconcile.mutate(prepared.credentialId)} loading={reconcile.isPending}>{t('actions.reconcile')}</Button>} /> : null}
      {prepared && prepared.expiresAt <= now && !submissionUncertain ? <Alert showIcon type="warning" title={t('messages.expired')} /> : null}
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
                form.setFieldValue('projectVersionId', undefined)
              }}
            />
          </Form.Item>
          <Form.Item name="projectVersionId" label={t('drawer.publishedVersion')} rules={[{ required: true }]}>
            <Select
              disabled={Boolean(prepared) || !issueProjectId}
              showSearch
              loading={versionsQuery.isLoading}
              optionFilterProp="label"
              placeholder={t('drawer.selectPublishedVersion')}
              options={(versionsQuery.data?.list || []).filter((item) => item.publishedAt && item.manifestVersion === 3).map((item) => ({ value: Number(item.id), label: `${item.version} · ${item.releaseHash?.slice(0, 10) || t('subject.noHash')}…` }))}
            />
          </Form.Item>
        </> : null}
        <Form.Item name="network" label={t('drawer.network')} rules={[{ required: true }]}>
          <Select disabled={Boolean(prepared)} options={(query.data?.networks || []).map((item) => ({ value: item.network, disabled: !item.enabled || !wallet.canSignForNetwork(item.network), label: `${networkLabel(item.network)}${item.enabled ? '' : t('network.disabled')}` }))} />
        </Form.Item>
        {prepared ? <Alert showIcon type="success" title={t('drawer.preparedTitle')} description={t('drawer.preparedDescription')} /> : null}
        <Descriptions size="small" column={1} items={[
          { key: 'signer', label: t('drawer.signer'), children: <Typography.Text code copyable>{prepared?.signerAddress || signer || t('drawer.notConnected')}</Typography.Text> },
          ...(prepared ? [
            { key: 'release', label: t('drawer.source'), children: `${prepared.project} / ${prepared.version}` },
            { key: 'hash', label: t('receipt.contentHash'), children: <Typography.Text code copyable>{prepared.releaseHash}</Typography.Text> },
            { key: 'network', label: t('receipt.networkTrust'), children: networkLabel(prepared.network, true) },
            { key: 'balance', label: t('drawer.balance'), children: t('units.lamports', { value: formatAdminNumber(locale, prepared.balanceLamports) }) },
            { key: 'fee', label: t('drawer.estimatedFee'), children: t('units.lamports', { value: formatAdminNumber(locale, prepared.feeLamports) }) },
            { key: 'memo', label: t('drawer.finalMemo'), children: <Typography.Text code copyable>{prepared.memo}</Typography.Text> },
          ] : []),
        ]} />
        {prepared && signer !== prepared.signerAddress ? <Alert showIcon type="warning" title={t('drawer.walletChangedTitle')} description={t('drawer.walletChangedDescription')} /> : null}
        {prepared ? <Space orientation="vertical" style={{ width: '100%' }}>
          <Button block type="primary" size="large" loading={submit.isPending} disabled={signer !== prepared.signerAddress || !wallet.canSignForNetwork(prepared.network)} onClick={() => submit.mutate(prepared)}>{t(submissionUncertain ? 'actions.retrySubmission' : 'actions.sign')}</Button>
          <Button block disabled={submit.isPending || submissionUncertain} onClick={() => void cancelPrepared('The administrator chose to revise the prepared evidence')}>{t('actions.backToEdit')}</Button>
        </Space> : <Button block type="primary" htmlType="submit" size="large" loading={prepare.isPending} disabled={!signer || !issueNetwork || !wallet.canSignForNetwork(issueNetwork)}>{t('actions.prepare')}</Button>}
      </Form>
    </Drawer>
  </AdminPage>
}
