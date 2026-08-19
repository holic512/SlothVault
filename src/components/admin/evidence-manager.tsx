'use client'

/**
 * @file evidence-manager.tsx
 * @project SlothVault
 * @module Release Evidence Administration
 * @description Provides a receipt-oriented version evidence center for search, wallet filtering, issuance, reconciliation, and network health.
 * @logic Index stored credentials, derive operational metrics, guide one version/network signing ceremony, and keep retry actions beside the corresponding attempt timeline.
 * @dependencies React Query, Ant Design, Solana Wallet Adapter, release evidence APIs
 * @index_tags admin,evidence,solana,wallet,receipts,reconciliation
 * @author holic512
 */
import { useEffect, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import {
  Alert,
  App,
  Button,
  Card,
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
import { useSearchParams } from 'next/navigation'

import { AdminPage, AdminPageActions } from '@/components/admin/admin-page'
import { signEvidenceTransaction } from '@/components/admin/evidence-transaction'
import { apiFetch, ApiClientError } from '@/lib/api-client'

type Network = 'mainnet' | 'devnet'
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
  projectVersionId: string
  projectId: string
  projectName: string
  version: string
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
type Prepared = {
  attemptId: string
  transactionBase64: string
  expiresAt: number
  feeLamports: number
  balanceLamports: number
  memo: string
  signerAddress: string
  project: string
  version: string
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
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const wallet = useWallet()
  const initialVersionId = searchParams.get('projectVersionId') || ''
  const [scope, setScope] = useState<'all' | 'wallet'>('all')
  const [network, setNetwork] = useState<Network | undefined>()
  const [status, setStatus] = useState<number | undefined>()
  const [signature, setSignature] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Evidence | null>(null)
  const [issueOpen, setIssueOpen] = useState(Boolean(initialVersionId))
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [form] = Form.useForm<{ projectVersionId: number; network: Network }>()
  const signer = wallet.publicKey?.toBase58() || ''

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
  const versionsQuery = useQuery({
    queryKey: ['published-versions-for-evidence'],
    queryFn: () => apiFetch<{ list: PublishedVersion[] }>('/api/admin/mm/projectVersion?pageSize=100&includeProject=1&orderBy=updatedAt&order=desc'),
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
    mutationFn: async (values: { projectVersionId: number; network: Network }) => {
      if (!signer) throw new Error('请先连接用于签名的钱包')
      return apiFetch<Prepared>('/api/admin/evidence/prepare', {
        method: 'POST',
        body: JSON.stringify({ ...values, signerAddress: signer }),
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
        signedTransactionBase64 = await signEvidenceTransaction(next.transactionBase64, wallet.signTransaction)
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

  const openIssue = (values?: { projectVersionId?: number; network?: Network }) => {
    form.setFieldsValue({
      projectVersionId: values?.projectVersionId ?? (initialVersionId ? Number(initialVersionId) : undefined),
      network: values?.network ?? query.data?.defaultNetwork ?? 'devnet',
    })
    setPrepared(null)
    setIssueOpen(true)
  }

  const columns: ColumnsType<Evidence> = [
    {
      title: '版本',
      render: (_, row) => <div><strong>{row.projectName}</strong><br /><Typography.Text type="secondary">{row.version}</Typography.Text></div>,
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
        {row.status === -1 ? <Button type="link" onClick={() => openIssue({ projectVersionId: Number(row.projectVersionId), network: row.network })}>重试</Button> : null}
        {row.status === 0 || row.status === 1 ? <Button type="link" loading={reconcile.isPending} onClick={() => reconcile.mutate(row.id)}>对账</Button> : null}
        {row.transactionSignature ? <Button type="link" href={`/evidence/${row.transactionSignature}`} target="_blank">核验</Button> : null}
      </Space>,
    },
  ]

  return <AdminPage>
    <AdminPageActions>
      <Space wrap>
        <WalletMultiButton />
        <Button icon={<RefreshCw size={15} />} loading={query.isFetching} onClick={() => void query.refetch()}>刷新</Button>
        <Button type="primary" icon={<FileSignature size={15} />} onClick={() => openIssue()}>办理存证</Button>
      </Space>
    </AdminPageActions>

    <Card className="evidence-ledger admin-table-card" title="版本存证" extra={<Typography.Text type="secondary">{query.data?.total || 0} 条记录</Typography.Text>}>
      <div className="evidence-toolbar">
        <Segmented options={[{ label: '全部', value: 'all' }, { label: '我的钱包', value: 'wallet', icon: <WalletCards size={14} /> }]} value={scope} onChange={(value) => { setScope(value as 'all' | 'wallet'); setPage(1) }} />
        <Space wrap>
          <Select allowClear placeholder="网络" value={network} onChange={(value) => { setNetwork(value); setPage(1) }} options={[{ value: 'mainnet', label: 'Mainnet · 正式' }, { value: 'devnet', label: 'Devnet · 测试' }]} />
          <Select allowClear placeholder="状态" value={status} onChange={(value) => { setStatus(value); setPage(1) }} options={Object.entries(STATUS).map(([value, item]) => ({ value: Number(value), label: item.label }))} />
          <Input allowClear prefix={<Search size={14} />} placeholder="交易编号" value={signature} onChange={(event) => { setSignature(event.target.value); setPage(1) }} />
        </Space>
      </div>
      {query.isError ? <Alert showIcon type="error" message="存证记录加载失败" description={evidenceErrorMessage(query.error)} action={<Button size="small" onClick={() => void query.refetch()}>重试</Button>} /> : null}
      {scope === 'wallet' && !signer ? <Alert showIcon type="info" message="连接钱包后，将只显示本站由该地址签署的凭证；不会扫描钱包的全部链上历史。" /> : null}
      <Table rowKey="id" size="small" loading={query.isLoading} dataSource={query.data?.list || []} columns={columns} scroll={{ x: 1080 }} pagination={{ current: page, pageSize: 20, total: query.data?.total || 0, showSizeChanger: false, onChange: setPage }} />
      <div className="evidence-mobile-list">
        {!query.isLoading && (query.data?.list.length || 0) === 0 ? <Empty description="暂无存证记录" /> : null}
        {(query.data?.list || []).map((row) => <article className="evidence-mobile-card" key={row.id}>
          <div><strong>{row.projectName} / {row.version}</strong><Tag color={row.network === 'devnet' ? 'warning' : 'success'}>{row.network === 'devnet' ? '测试凭证' : '正式存证'}</Tag></div>
          <code title={row.releaseHash || ''}>{compact(row.releaseHash, 14, 10)}</code>
          <Space><Tag color={STATUS[row.status as keyof typeof STATUS]?.color}>{STATUS[row.status as keyof typeof STATUS]?.label}</Tag><Typography.Text type="secondary">{compact(row.signerAddress)}</Typography.Text></Space>
          <Space><Button size="small" onClick={() => setSelected(row)}>详情</Button>{row.status === -1 ? <Button size="small" onClick={() => openIssue({ projectVersionId: Number(row.projectVersionId), network: row.network })}>重试</Button> : null}{row.status === 0 || row.status === 1 ? <Button size="small" onClick={() => reconcile.mutate(row.id)}>对账</Button> : null}{row.transactionSignature ? <Button size="small" href={`/evidence/${row.transactionSignature}`}>核验</Button> : null}</Space>
        </article>)}
      </div>
    </Card>

    <Drawer title="存证办理回执" width={560} open={Boolean(selected)} onClose={() => setSelected(null)}>
      {selected ? <>
        <Descriptions bordered size="small" column={1} items={[
          { key: 'release', label: '版本', children: `${selected.projectName} / ${selected.version}` },
          { key: 'hash', label: '完整哈希', children: <Typography.Text copyable code>{selected.releaseHash}</Typography.Text> },
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

    <Drawer title="办理版本交易存证" width={620} open={issueOpen} destroyOnHidden onClose={() => {
      if (prepare.isPending || submit.isPending) return
      setIssueOpen(false)
      form.resetFields()
      void cancelPrepared('The evidence drawer was closed before signing')
    }} extra={<WalletMultiButton />}>
      <Alert showIcon type="info" message="发布与存证相互独立" description="这里只能选择已经发布且完整性校验通过的版本。拒签或 RPC 故障不会撤销版本发布。" />
      {versionsQuery.isError ? <Alert showIcon type="error" message="可存证版本加载失败" description={evidenceErrorMessage(versionsQuery.error)} action={<Button size="small" onClick={() => void versionsQuery.refetch()}>重试</Button>} /> : null}
      <Form form={form} layout="vertical" initialValues={{ projectVersionId: initialVersionId ? Number(initialVersionId) : undefined }} onFinish={(values) => prepare.mutate(values)}>
        <Form.Item name="projectVersionId" label="已发布版本" rules={[{ required: true }]}>
          <Select
            disabled={Boolean(prepared)}
            showSearch
            loading={versionsQuery.isLoading}
            optionFilterProp="label"
            placeholder="选择需要签署哈希的版本"
            options={(versionsQuery.data?.list || []).filter((item) => item.publishedAt).map((item) => ({
              value: Number(item.id),
              label: `${item.project?.projectName || '项目'} / ${item.version} · ${item.releaseHash?.slice(0, 10) || '无哈希'}…`,
            }))}
          />
        </Form.Item>
        <Form.Item name="network" label="存证网络" rules={[{ required: true }]}>
          <Select disabled={Boolean(prepared)} options={(query.data?.networks || []).map((item) => ({ value: item.network, disabled: !item.enabled, label: `${item.network === 'mainnet' ? 'Mainnet · 正式存证' : 'Devnet · 测试凭证'}${item.enabled ? '' : '（已禁用）'}` }))} />
        </Form.Item>
        {prepared ? <Alert showIcon type="success" message="版本完整性与钱包余额校验通过" description="请逐项核对以下回执内容。点击确认后才会打开钱包签名窗口。" /> : null}
        <Descriptions size="small" column={1} items={[
          { key: 'signer', label: '签名钱包 / Fee Payer', children: <Typography.Text code copyable>{prepared?.signerAddress || signer || '未连接'}</Typography.Text> },
          ...(prepared ? [
            { key: 'release', label: '来源版本', children: `${prepared.project} / ${prepared.version}` },
            { key: 'hash', label: '版本完整哈希', children: <Typography.Text code copyable>{prepared.releaseHash}</Typography.Text> },
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
        </Space> : <Button block type="primary" htmlType="submit" size="large" loading={prepare.isPending} disabled={!signer}>校验版本并生成待签交易</Button>}
      </Form>
    </Drawer>
  </AdminPage>
}
