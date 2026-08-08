'use client'

/**
 * @file trees-panel.tsx
 * @project SlothVault
 * @module Solana Administration
 * @description Renders Merkle tree capacity metrics, records, verification, deletion, and wallet-funded creation.
 * @logic Query trees for the active network, derive capacity metrics, handle record actions, and prepare, sign, and submit tree creation transactions.
 * @dependencies Solana Wallet Adapter, Ant Design, React Query, next-intl, api-client, transaction helper
 * @index_tags admin,solana,merkle-tree,capacity,wallet,transactions
 * @author holic512
 */
import { useState } from 'react'

import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
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
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Boxes, Coins, Plus, RefreshCw, ShieldCheck, Trash2, Trees } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { apiFetch } from '@/lib/api-client'

import { signPreparedTransaction } from './transaction'
import type {
  EstimatePreset,
  PrepareTransaction,
  SolanaNetwork,
  SubmitTransaction,
  TreeDto,
} from './types'

export function TreesPanel({ network }: { network: SolanaNetwork }) {
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
