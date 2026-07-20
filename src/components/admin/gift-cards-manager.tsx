'use client'

/**
 * @file gift-cards-manager.tsx
 * @project SlothVault
 * @module Gift Card Administration
 * @description Issues point-card batches, shows aggregate redemption progress, and exposes plaintext codes exactly once.
 * @logic Submit bounded batch settings, immediately display/copy the one-time plaintext result, then rely on hash-safe aggregate listing for later management.
 * @dependencies Ant Design, React Query, gift-card admin API
 * @index_tags admin,gift-card,issuance,points,codes
 * @author holic512
 */
import { useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, InputNumber, Modal, Progress, Space, Table, Typography } from 'antd'
import { Copy, Plus, RefreshCw } from 'lucide-react'

import { apiFetch } from '@/lib/api-client'

type BatchRow = {
  id: string
  name: string
  points: number
  quantity: number
  redeemed: number
  status: number
  expiresAt: string | null
  createdBy: string
  createdAt: string
}

type IssueResult = {
  batch: BatchRow
  codes: string[]
}

export function GiftCardsManager() {
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [createOpen, setCreateOpen] = useState(false)
  const [issuedCodes, setIssuedCodes] = useState<string[]>([])
  const [form] = Form.useForm<{ name: string; points: number; quantity: number; expiresAt?: string }>()
  const query = useQuery({
    queryKey: ['admin-gift-cards', page, pageSize],
    queryFn: () => apiFetch<{ list: BatchRow[]; total: number }>(
      `/api/admin/mm/gift-cards?page=${page}&pageSize=${pageSize}`,
    ),
  })
  const mutation = useMutation({
    mutationFn: (values: ReturnType<typeof form.getFieldsValue>) =>
      apiFetch<IssueResult>('/api/admin/mm/gift-cards', {
        method: 'POST',
        body: JSON.stringify({
          ...values,
          expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null,
        }),
      }),
    onSuccess: async (result) => {
      setCreateOpen(false)
      setIssuedCodes(result.codes)
      form.resetFields()
      await queryClient.invalidateQueries({ queryKey: ['admin-gift-cards'] })
    },
    onError: (error) => message.error(error.message),
  })

  const copyCodes = async () => {
    await navigator.clipboard.writeText(issuedCodes.join('\n'))
    message.success('卡密已复制')
  }

  return (
    <div className="admin-page-stack">
      <div className="admin-page-heading">
        <div>
          <Typography.Title level={2}>卡密管理</Typography.Title>
          <Typography.Paragraph type="secondary">批量发行一次性卡密，用户兑换后写入积分流水。</Typography.Paragraph>
        </div>
        <Space>
          <Button icon={<RefreshCw size={15} />} onClick={() => void query.refetch()}>刷新</Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>发行卡密</Button>
        </Space>
      </div>

      <div className="admin-table-card">
        <Table<BatchRow>
          rowKey="id"
          loading={query.isLoading}
          dataSource={query.data?.list || []}
          pagination={{
            current: page,
            pageSize,
            total: query.data?.total || 0,
            showSizeChanger: true,
            onChange: (nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize) },
          }}
          columns={[
            { title: '批次', dataIndex: 'name', minWidth: 180 },
            { title: '面值', dataIndex: 'points', width: 100, render: (value) => `${value} 积分` },
            { title: '数量', dataIndex: 'quantity', width: 80 },
            {
              title: '兑换进度',
              width: 180,
              render: (_value, batch) => (
                <Progress
                  percent={batch.quantity ? Math.round(batch.redeemed / batch.quantity * 100) : 0}
                  format={() => `${batch.redeemed}/${batch.quantity}`}
                  strokeColor="var(--sv-primary)"
                />
              ),
            },
            { title: '到期时间', dataIndex: 'expiresAt', width: 180, render: (value) => value ? new Date(value).toLocaleString() : '长期有效' },
            { title: '发行人', dataIndex: 'createdBy', width: 120 },
          ]}
        />
      </div>

      <Modal
        open={createOpen}
        title="发行积分卡密"
        okText="生成卡密"
        cancelText="取消"
        confirmLoading={mutation.isPending}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" initialValues={{ quantity: 10, points: 100 }} onFinish={(values) => mutation.mutate(values)}>
          <Form.Item name="name" label="批次名称" rules={[{ required: true, min: 2 }]}><Input /></Form.Item>
          <div className="admin-form-grid">
            <Form.Item name="points" label="单卡积分" rules={[{ required: true }]}><InputNumber min={1} max={1000000} className="full-width" /></Form.Item>
            <Form.Item name="quantity" label="发行数量" rules={[{ required: true }]}><InputNumber min={1} max={500} className="full-width" /></Form.Item>
          </div>
          <Form.Item name="expiresAt" label="到期时间（可选）"><Input type="datetime-local" /></Form.Item>
        </Form>
      </Modal>

      <Modal
        open={issuedCodes.length > 0}
        title="卡密已生成"
        okText="我已保存"
        cancelButtonProps={{ style: { display: 'none' } }}
        onOk={() => setIssuedCodes([])}
        onCancel={() => setIssuedCodes([])}
      >
        <Typography.Paragraph type="secondary">
          系统只保存哈希；关闭后无法再次查看这些明文卡密。
        </Typography.Paragraph>
        <Input.TextArea rows={12} readOnly value={issuedCodes.join('\n')} />
        <Button className="gift-card-copy" block icon={<Copy size={15} />} onClick={() => void copyCodes()}>
          复制全部卡密
        </Button>
      </Modal>
    </div>
  )
}
