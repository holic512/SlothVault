'use client'

/**
 * @file solana-manager.tsx
 * @project SlothVault
 * @module Solana Administration
 * @description Replaces the Nuxt Solana pages and dialogs with one authenticated Ant Design tree and cNFT console.
 * @logic Select the configured network, prepare server-partially-signed transactions, request the connected wallet signature, submit opaque sessions, and refresh persisted chain records.
 * @dependencies Solana Wallet Adapter, @solana/web3.js, Ant Design, React Query, next-intl, api-client
 * @index_tags admin,solana,merkle-tree,cnft,wallet,transactions
 * @author holic512
 */
import { useState } from 'react'

import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { Transaction } from '@solana/web3.js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  Boxes,
  Coins,
  ExternalLink,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Trees,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import { apiFetch } from '@/lib/api-client'

type SolanaNetwork = 'mainnet' | 'devnet'
type TreeDto = {
  id: string
  name: string
  treeAddress: string
  treeAuthority: string
  creatorAddress: string
  maxDepth: number
  maxBufferSize: number
  canopyDepth: number
  network: SolanaNetwork
  totalMinted: number
  maxCapacity: string
  creationCost: string
  txSignature: string | null
  priority: number
  status: number
  createdAt: string
  updatedAt: string
  mintedCount: number
}
type CnftDto = {
  id: string
  projectId: string
  projectName: string | null
  projectAvatar: string | null
  assetId: string
  leafIndex: number
  name: string
  symbol: string | null
  metadataUri: string | null
  ownerAddress: string
  mintTxSignature: string | null
  status: number
  createdAt: string
  updatedAt: string
  merkleTree: { name: string; treeAddress: string; network: SolanaNetwork }
}
type ProjectOption = { id: string; projectName: string }
type EstimatePreset = {
  label: string
  maxDepth: number
  maxBufferSize: number
  canopyDepth: number
  capacity: number
  spaceBytes: number
  rentLamports: number
  rentSol: string
}
type PrepareTransaction = {
  transactionBase64: string
  sessionId: string
  expiresAt: number
}
type SubmitTransaction = {
  status: number
  txSignature: string | null
}

function decodeBase64(value: string) {
  const binary = window.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function encodeBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 8192
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return window.btoa(binary)
}

async function signPreparedTransaction(
  prepared: PrepareTransaction,
  signTransaction: ((transaction: Transaction) => Promise<Transaction>) | undefined,
) {
  if (!signTransaction) throw new Error('The connected wallet cannot sign transactions')
  const transaction = Transaction.from(decodeBase64(prepared.transactionBase64))
  const signed = await signTransaction(transaction)
  return encodeBase64(signed.serialize())
}

export function SolanaManager() {
  const t = useTranslations('AdminMM.solana')
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const configQuery = useQuery({
    queryKey: ['admin-solana-config'],
    queryFn: () => apiFetch<{ network: SolanaNetwork }>('/api/admin/solana/config'),
  })
  const network = configQuery.data?.network || 'devnet'

  const switchMutation = useMutation({
    mutationFn: (nextNetwork: SolanaNetwork) =>
      apiFetch<{ network: SolanaNetwork }>('/api/admin/solana/config', {
        method: 'PUT',
        body: JSON.stringify({ network: nextNetwork }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-solana'] })
      await queryClient.invalidateQueries({ queryKey: ['admin-solana-config'] })
    },
    onError: (error) => message.error(error.message),
  })

  const switchNetwork = (nextNetwork: SolanaNetwork) => {
    if (nextNetwork === network) return
    if (nextNetwork === 'mainnet') {
      modal.confirm({
        title: t('network.switchToMainnet'),
        content: t('network.switchWarning'),
        okText: t('network.confirmSwitch'),
        cancelText: t('network.cancel'),
        okButtonProps: { danger: true },
        onOk: () => switchMutation.mutate('mainnet'),
      })
    } else {
      switchMutation.mutate('devnet')
    }
  }

  return (
    <div className="admin-page-stack">
      <div className="admin-page-heading">
        <div>
          <Typography.Title level={2}>{t('title')}</Typography.Title>
          <Typography.Paragraph type="secondary">{t('desc')}</Typography.Paragraph>
        </div>
        <Space>
          <Typography.Text type="secondary">{t('network.label')}</Typography.Text>
          <Select
            value={network}
            loading={configQuery.isLoading || switchMutation.isPending}
            options={[
              { value: 'devnet', label: t('network.devnet') },
              { value: 'mainnet', label: t('network.mainnet') },
            ]}
            onChange={switchNetwork}
          />
        </Space>
      </div>
      {network === 'mainnet' ? <Alert showIcon type="warning" message={t('network.switchWarning')} /> : null}
      <Tabs
        className="solana-tabs"
        items={[
          {
            key: 'trees',
            label: t('tabs.trees'),
            children: <TreesPanel network={network} />,
          },
          {
            key: 'cnfts',
            label: t('tabs.cnfts'),
            children: <CnftsPanel network={network} />,
          },
        ]}
      />
    </div>
  )
}

function TreesPanel({ network }: { network: SolanaNetwork }) {
  const t = useTranslations('AdminMM.solana.trees')
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const query = useQuery({
    queryKey: ['admin-solana-trees', network],
    queryFn: () => apiFetch<TreeDto[]>(`/api/admin/solana/tree?network=${network}`),
  })
  const trees = query.data || []
  const totalCapacity = trees.reduce((sum, tree) => sum + BigInt(tree.maxCapacity), 0n)
  const totalMinted = trees.reduce((sum, tree) => sum + BigInt(tree.totalMinted), 0n)
  const available = trees.filter(
    (tree) => tree.status === 1 && BigInt(tree.totalMinted) < BigInt(tree.maxCapacity),
  ).length
  const usage = totalCapacity > 0n ? Number((totalMinted * 10_000n) / totalCapacity) / 100 : 0

  const verifyMutation = useMutation({
    mutationFn: (treeId: string) =>
      apiFetch(`/api/admin/solana/tree/${treeId}/verify`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: async () => {
      message.success(t('messages.verifySuccess'))
      await queryClient.invalidateQueries({ queryKey: ['admin-solana-trees'] })
    },
    onError: (error) => message.error(error.message),
  })
  const remove = (tree: TreeDto) => {
    modal.confirm({
      title: t('messages.deleteConfirmTitle'),
      content: t('messages.deleteConfirm', { name: tree.name }),
      okText: t('messages.deleteButton'),
      okButtonProps: { danger: true },
      cancelText: t('messages.cancelButton'),
      onOk: async () => {
        await apiFetch(`/api/admin/solana/tree/${tree.id}`, { method: 'DELETE' })
        message.success(t('messages.deleteSuccess'))
        await queryClient.invalidateQueries({ queryKey: ['admin-solana-trees'] })
      },
    })
  }

  const columns: ColumnsType<TreeDto> = [
    {
      title: t('table.name'),
      dataIndex: 'name',
      minWidth: 150,
      render: (value, row) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{value}</Typography.Text>
          <Typography.Text copyable={{ text: row.treeAddress }} type="secondary" className="mono-ellipsis">
            {row.treeAddress}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('table.capacityUsage'),
      width: 210,
      render: (_value, row) => {
        const percent = Math.min(100, (row.totalMinted / Number(row.maxCapacity)) * 100)
        return (
          <Space orientation="vertical" size={2} className="full-width">
            <Typography.Text>{row.totalMinted.toLocaleString()} / {Number(row.maxCapacity).toLocaleString()}</Typography.Text>
            <Progress percent={Number.isFinite(percent) ? percent : 0} size="small" showInfo={false} />
          </Space>
        )
      },
    },
    {
      title: t('table.config'),
      width: 190,
      render: (_value, row) => t('table.configFormat', {
        depth: row.maxDepth,
        buffer: row.maxBufferSize,
        canopy: row.canopyDepth,
      }),
    },
    {
      title: t('table.creationCost'),
      width: 115,
      render: (_value, row) => `${(Number(row.creationCost) / 1_000_000_000).toFixed(4)} SOL`,
    },
    { title: t('table.priority'), dataIndex: 'priority', width: 80, align: 'center' },
    {
      title: t('table.status'),
      width: 100,
      render: (_value, row) => <TreeStatus status={row.status} />,
    },
    {
      title: t('table.operations'),
      fixed: 'right',
      width: 170,
      render: (_value, row) => (
        <Space size={2}>
          {row.status === 0 || row.status === -1 ? (
            <Button type="link" icon={<ShieldCheck size={13} />} onClick={() => verifyMutation.mutate(row.id)}>
              {t('operations.verify')}
            </Button>
          ) : null}
          {row.status === 0 || row.status === -1 ? (
            <Button type="link" danger icon={<Trash2 size={13} />} onClick={() => remove(row)}>
              {t('operations.delete')}
            </Button>
          ) : null}
        </Space>
      ),
    },
  ]

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <Row gutter={[12, 12]}>
        <SolanaMetric title={t('stats.availableTrees')} value={available} icon={<Trees />} />
        <SolanaMetric title={t('stats.totalCapacity')} value={Number(totalCapacity)} icon={<Boxes />} />
        <SolanaMetric title={t('stats.minted')} value={Number(totalMinted)} icon={<Coins />} />
        <SolanaMetric title={t('stats.usageRate')} value={usage} suffix="%" icon={<ShieldCheck />} />
      </Row>
      <div className="admin-toolbar-card">
        <Typography.Text type="secondary">
          {available === 0 ? t('capacityWarning') : `${available} ${t('stats.availableTrees')}`}
        </Typography.Text>
        <Space>
          <Button icon={<RefreshCw size={14} />} onClick={() => void query.refetch()}>{t('actions.refresh')}</Button>
          <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>{t('actions.createTree')}</Button>
        </Space>
      </div>
      <div className="admin-table-card">
        <Table rowKey="id" loading={query.isLoading} dataSource={trees} columns={columns} pagination={false} scroll={{ x: 1100 }} />
      </div>
      <CreateTreeDialog
        open={createOpen}
        network={network}
        onClose={() => setCreateOpen(false)}
        onCreated={async () => {
          setCreateOpen(false)
          await queryClient.invalidateQueries({ queryKey: ['admin-solana-trees'] })
        }}
      />
    </Space>
  )
}

function SolanaMetric({
  title,
  value,
  suffix,
  icon,
}: {
  title: string
  value: number
  suffix?: string
  icon: React.ReactNode
}) {
  return (
    <Col xs={24} sm={12} xl={6}>
      <Card className="metric-card">
        <Space align="start" className="metric-card-inner">
          <Statistic title={title} value={value} suffix={suffix} />
          <span className="metric-icon">{icon}</span>
        </Space>
      </Card>
    </Col>
  )
}

function TreeStatus({ status }: { status: number }) {
  const t = useTranslations('AdminMM.solana.trees.status')
  if (status === 1) return <Tag color="success">{t('normal')}</Tag>
  if (status === 2) return <Tag color="blue">{t('full')}</Tag>
  if (status === 0) return <Tag color="processing">{t('creating')}</Tag>
  if (status === -1) return <Tag color="error">{t('failed')}</Tag>
  return <Tag>{t('unknown')}</Tag>
}

function CreateTreeDialog({
  open,
  network,
  onClose,
  onCreated,
}: {
  open: boolean
  network: SolanaNetwork
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const { publicKey, signTransaction, connected } = useWallet()
  const { setVisible } = useWalletModal()
  const { message } = App.useApp()
  const [form] = Form.useForm<{ name: string; preset: string }>()
  const estimatesQuery = useQuery({
    queryKey: ['admin-solana-tree-estimates', network],
    enabled: open,
    queryFn: () =>
      apiFetch<{ presets: EstimatePreset[]; isEstimate: boolean }>('/api/admin/solana/tree/estimate', {
        method: 'POST',
        body: JSON.stringify({ network }),
      }),
  })
  const createMutation = useMutation({
    mutationFn: async (values: { name: string; preset: string }) => {
      if (!connected || !publicKey) {
        setVisible(true)
        throw new Error('Connect a Solana wallet first')
      }
      const preset = estimatesQuery.data?.presets.find(
        (item) => `${item.maxDepth}:${item.maxBufferSize}:${item.canopyDepth}` === values.preset,
      )
      if (!preset) throw new Error('Choose a tree preset')
      const prepared = await apiFetch<PrepareTransaction>('/api/admin/solana/tree/prepare', {
        method: 'POST',
        body: JSON.stringify({
          name: values.name,
          maxDepth: preset.maxDepth,
          maxBufferSize: preset.maxBufferSize,
          canopyDepth: preset.canopyDepth,
          payerAddress: publicKey.toBase58(),
          network,
        }),
      })
      const signedTransactionBase64 = await signPreparedTransaction(prepared, signTransaction)
      return apiFetch<SubmitTransaction>('/api/admin/solana/tree/submit', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: prepared.sessionId,
          signedTransactionBase64,
        }),
      })
    },
    onSuccess: async (result) => {
      if (result.status === 1) message.success('Merkle Tree created')
      else if (result.status === 0) message.warning('Transaction submitted and awaiting confirmation')
      else message.error('Merkle Tree transaction failed')
      form.resetFields()
      await onCreated()
    },
    onError: (error) => message.error(error.message),
  })
  const presetOptions = (estimatesQuery.data?.presets || []).map((preset) => ({
    value: `${preset.maxDepth}:${preset.maxBufferSize}:${preset.canopyDepth}`,
    label: `${preset.label} · ${preset.capacity.toLocaleString()} leaves · ${preset.rentSol} SOL`,
  }))

  return (
    <Modal
      open={open}
      title="Create Merkle Tree"
      okText="Prepare, sign and submit"
      confirmLoading={createMutation.isPending}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Alert
        showIcon
        type={network === 'mainnet' ? 'warning' : 'info'}
        message={`${network.toUpperCase()} · wallet pays rent and fees`}
      />
      <Form
        form={form}
        layout="vertical"
        initialValues={{ name: '', preset: '14:64:0' }}
        onFinish={(values) => createMutation.mutate(values)}
      >
        <Form.Item name="name" label="Tree name" rules={[{ required: true }]}>
          <Input maxLength={128} showCount />
        </Form.Item>
        <Form.Item name="preset" label="Capacity preset" rules={[{ required: true }]}>
          <Select loading={estimatesQuery.isLoading} options={presetOptions} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function CnftsPanel({ network }: { network: SolanaNetwork }) {
  const t = useTranslations('AdminMM.solana.cnfts')
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [projectId, setProjectId] = useState<string>()
  const [status, setStatus] = useState<string>()
  const [owner, setOwner] = useState('')
  const [mintOpen, setMintOpen] = useState(false)

  const projectsQuery = useQuery({
    queryKey: ['admin-solana-project-options'],
    queryFn: () => apiFetch<{ list: ProjectOption[] }>('/api/admin/mm/project?pageSize=100'),
  })
  const query = useQuery({
    queryKey: ['admin-solana-cnfts', network, projectId, status, owner, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({ network, page: String(page), pageSize: String(pageSize) })
      if (projectId) params.set('projectId', projectId)
      if (status) params.set('status', status)
      if (owner) params.set('ownerAddress', owner)
      return apiFetch<{ list: CnftDto[]; total: number }>(`/api/admin/solana/cnft?${params}`)
    },
  })
  const remove = (cnft: CnftDto) => {
    modal.confirm({
      title: t('messages.deleteConfirmTitle'),
      content: t('messages.deleteConfirm', {
        status: cnft.status,
        name: cnft.name,
        owner: cnft.ownerAddress,
      }),
      okText: t('messages.deleteButton'),
      okButtonProps: { danger: true },
      cancelText: t('messages.cancelButton'),
      onOk: async () => {
        await apiFetch(`/api/admin/solana/cnft/${cnft.id}`, { method: 'DELETE' })
        message.success(t('messages.deleteSuccess'))
        await queryClient.invalidateQueries({ queryKey: ['admin-solana-cnfts'] })
      },
    })
  }
  const columns: ColumnsType<CnftDto> = [
    {
      title: t('table.nftInfo'),
      minWidth: 190,
      render: (_value, row) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{row.name}</Typography.Text>
          <Typography.Text type="secondary">
            {row.symbol || '—'} · leaf {row.status === 1 ? row.leafIndex : 'pending'}
          </Typography.Text>
        </Space>
      ),
    },
    { title: t('table.project'), dataIndex: 'projectName', width: 150, render: (value) => value || '-' },
    {
      title: t('table.owner'),
      dataIndex: 'ownerAddress',
      minWidth: 190,
      render: (value) => <Typography.Text copyable={{ text: value }} className="mono-ellipsis">{value}</Typography.Text>,
    },
    {
      title: t('table.merkleTree'),
      width: 150,
      render: (_value, row) => row.merkleTree.name,
    },
    {
      title: t('table.status'),
      dataIndex: 'status',
      width: 100,
      render: (value) =>
        value === 1 ? <Tag color="success">{t('status.normal')}</Tag> : value === 0 ? <Tag color="processing">{t('status.minting')}</Tag> : <Tag color="error">{t('status.failed')}</Tag>,
    },
    {
      title: t('table.assetId'),
      dataIndex: 'assetId',
      minWidth: 190,
      render: (value, row) =>
        row.status === 1 ? (
          <Typography.Text copyable={{ text: value }} className="mono-ellipsis">{value}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">
            {row.status === 0 ? t('status.minting') : t('status.failed')}
          </Typography.Text>
        ),
    },
    {
      title: t('table.operations'),
      fixed: 'right',
      width: 110,
      render: (_value, row) =>
        row.status === -1 ? (
          <Button type="link" danger icon={<Trash2 size={13} />} onClick={() => remove(row)}>
            {t('operations.delete')}
          </Button>
        ) : row.metadataUri ? (
          <Button type="link" href={row.metadataUri.replace('ipfs://', 'https://ipfs.io/ipfs/')} target="_blank" icon={<ExternalLink size={13} />} />
        ) : null,
    },
  ]

  return (
    <Space orientation="vertical" size={16} className="full-width">
      <div className="admin-toolbar-card">
        <div className="admin-filters">
          <Select
            allowClear
            showSearch
            value={projectId}
            placeholder={t('filters.byProject')}
            optionFilterProp="label"
            options={(projectsQuery.data?.list || []).map((project) => ({ value: project.id, label: project.projectName }))}
            onChange={(value) => { setProjectId(value); setPage(1) }}
          />
          <Select
            allowClear
            value={status}
            placeholder={t('filters.byStatus')}
            options={[
              { value: '0', label: t('status.minting') },
              { value: '1', label: t('status.normal') },
              { value: '-1', label: t('status.failed') },
            ]}
            onChange={(value) => { setStatus(value); setPage(1) }}
          />
          <Input.Search
            allowClear
            value={owner}
            placeholder={t('filters.searchOwner')}
            onChange={(event) => setOwner(event.target.value)}
            onSearch={() => setPage(1)}
          />
        </div>
        <Space>
          <Button icon={<RefreshCw size={14} />} onClick={() => void query.refetch()}>{t('actions.refresh')}</Button>
          <Button type="primary" icon={<Plus size={14} />} onClick={() => setMintOpen(true)}>{t('actions.mint')}</Button>
        </Space>
      </div>
      <div className="admin-table-card">
        <Table
          rowKey="id"
          loading={query.isLoading}
          dataSource={query.data?.list || []}
          columns={columns}
          scroll={{ x: 1200 }}
          pagination={{
            current: page,
            pageSize,
            total: query.data?.total || 0,
            showSizeChanger: true,
            onChange: (nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize) },
          }}
        />
      </div>
      <MintCnftDialog
        open={mintOpen}
        network={network}
        projects={projectsQuery.data?.list || []}
        onClose={() => setMintOpen(false)}
        onMinted={async () => {
          setMintOpen(false)
          await queryClient.invalidateQueries({ queryKey: ['admin-solana-cnfts'] })
          await queryClient.invalidateQueries({ queryKey: ['admin-solana-trees'] })
        }}
      />
    </Space>
  )
}

function MintCnftDialog({
  open,
  network,
  projects,
  onClose,
  onMinted,
}: {
  open: boolean
  network: SolanaNetwork
  projects: ProjectOption[]
  onClose: () => void
  onMinted: () => Promise<void>
}) {
  const { publicKey, signTransaction, connected } = useWallet()
  const { setVisible } = useWalletModal()
  const { message } = App.useApp()
  const [form] = Form.useForm<{
    projectId: string
    ownerAddress: string
    name: string
    symbol?: string
    description?: string
    metadataUri?: string
    useProjectAvatar: boolean
  }>()
  const mutation = useMutation({
    mutationFn: async (values: ReturnType<typeof form.getFieldsValue>) => {
      if (!connected || !publicKey) {
        setVisible(true)
        throw new Error('Connect a Solana wallet first')
      }
      const prepared = await apiFetch<PrepareTransaction>('/api/admin/solana/cnft/prepare', {
        method: 'POST',
        body: JSON.stringify({ ...values, payerAddress: publicKey.toBase58(), network }),
      })
      const signedTransactionBase64 = await signPreparedTransaction(prepared, signTransaction)
      return apiFetch<SubmitTransaction>('/api/admin/solana/cnft/submit', {
        method: 'POST',
        body: JSON.stringify({ sessionId: prepared.sessionId, signedTransactionBase64 }),
      })
    },
    onSuccess: async (result) => {
      if (result.status === 1) message.success('cNFT minted successfully')
      else if (result.status === 0) message.warning('Transaction submitted and awaiting confirmation')
      else message.error('cNFT transaction failed')
      form.resetFields()
      await onMinted()
    },
    onError: (error) => message.error(error.message),
  })

  const openWallet = () => {
    if (publicKey) form.setFieldValue('ownerAddress', publicKey.toBase58())
    else setVisible(true)
  }

  return (
    <Modal
      open={open}
      width={620}
      title="Mint project access cNFT"
      okText="Prepare, sign and submit"
      confirmLoading={mutation.isPending}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ ownerAddress: publicKey?.toBase58() || '', useProjectAvatar: true }}
        onFinish={(values) => mutation.mutate(values)}
      >
        <Form.Item name="projectId" label="Project" rules={[{ required: true }]}>
          <Select showSearch optionFilterProp="label" options={projects.map((project) => ({ value: project.id, label: project.projectName }))} />
        </Form.Item>
        <Form.Item name="ownerAddress" label="Owner wallet" rules={[{ required: true }]}>
          <Input addonAfter={<Button type="link" size="small" onClick={openWallet}>Use connected</Button>} />
        </Form.Item>
        <div className="admin-form-grid">
          <Form.Item name="name" label="NFT name" rules={[{ required: true }]}>
            <Input maxLength={32} showCount />
          </Form.Item>
          <Form.Item name="symbol" label="Symbol"><Input maxLength={10} /></Form.Item>
        </div>
        <Form.Item name="description" label="Description"><Input.TextArea rows={3} /></Form.Item>
        <Form.Item name="metadataUri" label="Metadata URI"><Input placeholder="ipfs://... (optional)" /></Form.Item>
        <Form.Item name="useProjectAvatar" label="Upload project avatar to Filebase when configured" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  )
}
