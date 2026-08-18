'use client'

/**
 * @file account-contracts-view.tsx
 * @project SlothVault
 * @module Account Contracts Workspace
 * @description Lets an assigned user read their private frozen contract, download its protected PDF, and record a Web2 acceptance or rejection.
 * @logic Fetch only the session user's contracts, require an explicit acknowledgement before signing, and leave the exact frozen Markdown visible beside its hash and on-chain state.
 * @dependencies React Query, Ant Design, MarkdownView, account contract APIs
 * @index_tags account,contracts,web2-signature,decline,attachment,privacy
 * @author holic512
 */
import { useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Checkbox, Descriptions, Drawer, Form, Input, List, Modal, Space, Tag, Typography } from 'antd'
import { BadgeCheck, FileCheck2, FileText, PenLine, ShieldCheck, XCircle } from 'lucide-react'

import { MarkdownView } from '@/components/markdown/markdown-view'
import { apiFetch } from '@/lib/api-client'
import contractStyles from '@/styles/modules/contracts.module.css'

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
  declinedAt: string | null
  declineReason: string | null
  cancelledAt: string | null
  issuer: { username: string; displayName: string | null }
  credentials: Array<{ id: string; network: 'mainnet' | 'devnet'; transactionSignature: string | null; status: number; finalizedAt: string | null }>
}

const STATUS: Record<number, { label: string; color: string }> = {
  [-2]: { label: '已取消', color: 'default' },
  [-1]: { label: '已拒签', color: 'error' },
  0: { label: '草稿', color: 'default' },
  1: { label: '待您签约', color: 'processing' },
  2: { label: '已签约', color: 'success' },
}

function statusTag(status: number) {
  const entry = STATUS[status] || { label: '未知', color: 'default' }
  return <Tag color={entry.color}>{entry.label}</Tag>
}

export function AccountContractsView() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Contract | null>(null)
  const [signing, setSigning] = useState<Contract | null>(null)
  const [declining, setDeclining] = useState<Contract | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [declineForm] = Form.useForm<{ reason?: string }>()
  const contracts = useQuery({
    queryKey: ['account-contracts'],
    queryFn: () => apiFetch<{ list: Contract[]; total: number }>('/api/account/contracts?page=1&pageSize=50'),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['account-contracts'] })
  const sign = useMutation({
    mutationFn: (id: string) => apiFetch<Contract>(`/api/account/contracts/${id}/sign`, { method: 'POST', body: '{}' }),
    onSuccess: async (result) => { message.success('合同已完成在线签约，等待管理员手动上链存证。'); setSigning(null); setSelected(result); await refresh() },
    onError: (error) => message.error(error.message),
  })
  const decline = useMutation({
    mutationFn: (values: { reason?: string }) => apiFetch<Contract>(`/api/account/contracts/${declining!.id}/decline`, { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: async (result) => { message.success('已记录拒签结果'); setDeclining(null); setSelected(result); declineForm.resetFields(); await refresh() },
    onError: (error) => message.error(error.message),
  })

  return <div className={`account-route ${contractStyles.account}`}>
    <div className="account-route-heading">
      <div><Typography.Text className="account-eyebrow">Contract desk</Typography.Text><Typography.Title level={2}>我的合同</Typography.Title><Typography.Text type="secondary">在线确认冻结的合同正文。签约不需要连接钱包，链上防篡改存证由管理员单独办理。</Typography.Text></div>
    </div>
    <Alert type="info" showIcon message="Web2 在线签约" description="点击确认后，系统会记录当前账户、时间、会话和基础客户端审计信息。此功能不替代法定电子签名或司法公证。" />
    <Card className={contractStyles['list-card']} title="分配给我的合同">
      <List
        loading={contracts.isLoading}
        locale={{ emptyText: '暂无分配给您的合同' }}
        dataSource={contracts.data?.list || []}
        renderItem={(contract) => <List.Item actions={[<Button key="view" type="link" onClick={() => setSelected(contract)}>查看合同</Button>]}>
          <List.Item.Meta avatar={<FileText size={22} />} title={<Space>{contract.title}{statusTag(contract.status)}</Space>} description={<span>管理员：{contract.issuer.displayName || contract.issuer.username} · 发起于 {contract.issuedAt ? new Date(contract.issuedAt).toLocaleString() : '草稿中'}</span>} />
          {contract.credentials.some((credential) => credential.status === 2) ? <Tag icon={<BadgeCheck size={12} />} color="success">已上链</Tag> : null}
        </List.Item>}
      />
    </Card>

    <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} width={760} title="合同详情">
      {selected ? <ContractRead contract={selected} onSign={() => { setAcknowledged(false); setSigning(selected) }} onDecline={() => { declineForm.resetFields(); setDeclining(selected) }} /> : null}
    </Drawer>
    <Modal open={Boolean(signing)} title="确认在线签约" okText="确认签约" cancelText="返回阅读" confirmLoading={sign.isPending} okButtonProps={{ disabled: !acknowledged }} onCancel={() => setSigning(null)} onOk={() => signing && sign.mutate(signing.id)}>
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Alert type="warning" showIcon message="确认前请核对正文与 SHA-256 摘要" description="签约后该合同内容不可修改；如不同意，请选择拒签。" />
        <Checkbox checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)}>我已阅读并同意以当前显示的冻结正文作为合同内容。</Checkbox>
      </Space>
    </Modal>
    <Modal open={Boolean(declining)} title="拒绝签约" okText="确认拒签" okButtonProps={{ danger: true }} cancelText="返回" confirmLoading={decline.isPending} onCancel={() => setDeclining(null)} onOk={() => declineForm.submit()}>
      <Form form={declineForm} layout="vertical" onFinish={(values) => decline.mutate(values)}><Form.Item name="reason" label="拒签原因（可选）"><Input.TextArea rows={4} maxLength={500} showCount /></Form.Item></Form>
    </Modal>
  </div>
}

function ContractRead({ contract, onSign, onDecline }: { contract: Contract; onSign: () => void; onDecline: () => void }) {
  const credential = contract.credentials.find((item) => item.status === 2) || contract.credentials[0]
  return <div className={contractStyles.detail}>
    <section className={contractStyles.paper}>
      <div className={contractStyles['paper-header']}><FileCheck2 size={18} /><div><Typography.Text type="secondary">YOUR CONTRACT</Typography.Text><Typography.Title level={3}>{contract.title}</Typography.Title></div></div>
      <Descriptions column={1} size="small" items={[
        { key: 'status', label: '签约状态', children: statusTag(contract.status) },
        { key: 'body', label: '正文 SHA-256', children: <Typography.Text code copyable>{contract.bodyHash}</Typography.Text> },
        { key: 'root', label: '合同根哈希', children: contract.contractHash ? <Typography.Text code copyable>{contract.contractHash}</Typography.Text> : '签约后生成' },
        { key: 'attachment', label: 'PDF 附件', children: contract.attachment ? <a href={`/api/account/contracts/${contract.id}/attachment`} target="_blank" rel="noreferrer">{contract.attachment.originalName}</a> : '无' },
        { key: 'evidence', label: '链上存证', children: credential?.transactionSignature ? <a href={`/contract-evidence/${credential.transactionSignature}`} target="_blank" rel="noreferrer">{credential.network === 'mainnet' ? '查看 Mainnet 凭证' : '查看 Devnet 测试凭证'}</a> : '管理员尚未发起' },
      ]} />
      <div className={contractStyles.body}><MarkdownView content={contract.body} /></div>
    </section>
    {contract.declineReason ? <Alert type="error" showIcon message="您已拒绝此合同" description={contract.declineReason} /> : null}
    {contract.status === 1 ? <div className={contractStyles['user-actions']}><Button type="primary" icon={<PenLine size={15} />} onClick={onSign}>阅读完毕，在线签约</Button><Button danger icon={<XCircle size={15} />} onClick={onDecline}>拒绝签约</Button></div> : null}
    {contract.status === 2 ? <Alert type="success" showIcon icon={<ShieldCheck />} message={`已于 ${contract.signedAt ? new Date(contract.signedAt).toLocaleString() : ''} 完成在线签约`} description="管理员可随后用其钱包将合同摘要写入链上。" /> : null}
  </div>
}
