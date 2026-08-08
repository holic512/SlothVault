'use client'

/**
 * @file cnfts-panel.tsx
 * @project SlothVault
 * @module Solana Administration
 * @description Renders cNFT filtering, records, deletion, metadata links, and wallet-signed article copyright minting.
 * @logic Query project and cNFT records for the active network, preserve pagination and filters, and prepare, sign, and submit mint transactions.
 * @dependencies Solana Wallet Adapter, Ant Design, React Query, next-intl, api-client, transaction helper
 * @index_tags admin,solana,cnft,articles,copyright,wallet,transactions
 * @author holic512
 */
import { useState } from 'react'

import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { apiFetch } from '@/lib/api-client'

import { signPreparedTransaction } from './transaction'
import type {
  CnftDto,
  NoteOption,
  PrepareTransaction,
  ProjectOption,
  SolanaNetwork,
  SubmitTransaction,
} from './types'

export function CnftsPanel({ network }: { network: SolanaNetwork }) {
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
    {
      title: 'Article',
      width: 190,
      render: (_value, row) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text>{row.noteTitle || row.name}</Typography.Text>
          <Typography.Text type="secondary">{row.projectName || 'Legacy certificate'}</Typography.Text>
        </Space>
      ),
    },
    { title: 'Copyright owner', dataIndex: 'copyrightOwner', width: 140, render: (value) => value || '-' },
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
    noteInfoId: string
    ownerAddress: string
    name: string
    symbol?: string
    description?: string
    metadataUri?: string
    useProjectAvatar: boolean
  }>()
  const selectedProjectId = Form.useWatch('projectId', form)
  const notesQuery = useQuery({
    queryKey: ['admin-solana-article-options', selectedProjectId],
    enabled: open && Boolean(selectedProjectId),
    queryFn: () => apiFetch<{ list: NoteOption[] }>(
      `/api/admin/mm/note?pageSize=100&status=1&projectId=${selectedProjectId}`,
    ),
  })
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
      title="Mint article copyright cNFT"
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
          <Select
            showSearch
            optionFilterProp="label"
            options={projects.map((project) => ({ value: project.id, label: project.projectName }))}
            onChange={() => form.setFieldValue('noteInfoId', undefined)}
          />
        </Form.Item>
        <Form.Item name="noteInfoId" label="Published article" rules={[{ required: true }]}>
          <Select
            showSearch
            loading={notesQuery.isLoading}
            disabled={!selectedProjectId}
            optionFilterProp="label"
            options={(notesQuery.data?.list || []).map((note) => ({
              value: note.id,
              label: note.noteTitle,
            }))}
          />
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
        <Form.Item name="useProjectAvatar" label="Use collection avatar for certificate metadata" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  )
}
