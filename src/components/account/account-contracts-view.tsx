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
import { Alert, App, Button, Checkbox, Descriptions, Drawer, Empty, Form, Input, Modal, Pagination, Space, Tag, Typography } from 'antd'
import { BadgeCheck, FileCheck2, FileText, PenLine, ShieldCheck, XCircle } from 'lucide-react'

import { MarkdownView } from '@/components/markdown/markdown-view'
import { AccountCard } from '@/components/account/account-card'
import { AccountQueryError } from '@/components/account/account-query-error'
import { ApiClientError, apiFetch } from '@/lib/api-client'
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
  subject: { username: string; displayName: string | null }
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
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Contract | null>(null)
  const [signing, setSigning] = useState<Contract | null>(null)
  const [declining, setDeclining] = useState<Contract | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [declineForm] = Form.useForm<{ reason?: string }>()
  const contracts = useQuery({
    queryKey: ['account-contracts', page],
    queryFn: () => apiFetch<{ list: Contract[]; total: number }>(`/api/account/contracts?page=${page}&pageSize=20`),
  })
  const selectedContract = useQuery({
    queryKey: ['account-contract', selected?.id],
    queryFn: () => apiFetch<Contract>(`/api/account/contracts/${selected!.id}`),
    enabled: Boolean(selected),
  })
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['account-contracts'] }),
    queryClient.invalidateQueries({ queryKey: ['account-contract'] }),
  ])
  const handleActionError = (error: Error) => {
    if (error instanceof ApiClientError && (error.status === 409 || error.status === 404)) {
      message.error('合同状态已变化，请重新阅读最新内容后再操作。')
      setSigning(null)
      setDeclining(null)
      void refresh()
    } else {
      message.error('操作未完成，请检查网络后重试。')
    }
  }
  const sign = useMutation({
    mutationFn: (id: string) => apiFetch<Contract>(`/api/account/contracts/${id}/sign`, { method: 'POST', body: '{}' }),
    onSuccess: async (result) => { message.success('合同已签约，您可随时回到这里查看正文与附件。'); setSigning(null); setSelected(result); await refresh() },
    onError: handleActionError,
  })
  const decline = useMutation({
    mutationFn: (values: { reason?: string }) => apiFetch<Contract>(`/api/account/contracts/${declining!.id}/decline`, { method: 'POST', body: JSON.stringify(values) }),
    onSuccess: async (result) => { message.success('已记录拒签结果'); setDeclining(null); setSelected(result); declineForm.resetFields(); await refresh() },
    onError: handleActionError,
  })

  return <div className={`account-route ${contractStyles.account}`}>
    <div className="account-route-heading">
      <div><Typography.Title level={1}>我的合同</Typography.Title><Typography.Text type="secondary">阅读合同与附件，核对开发范围、交付时间和费用，再确认签约。无需连接钱包。</Typography.Text></div>
    </div>
    <Alert type="info" showIcon title="先阅读，再确认" description="如有条款需要调整，请先联系管理员；拒签后需由管理员重新发起合同。在线确认会记录您的账户与确认时间，不替代法定电子签名或司法公证。" />
    {contracts.isError ? (
      <AccountQueryError retry={() => void contracts.refetch()} />
    ) : (
        <AccountCard className="account-contract-list" title="分配给我的合同" loading={contracts.isLoading}>
          {contracts.data?.list.length ? <ul className={contractStyles['contract-list']}>
            {contracts.data.list.map((contract) => <li key={contract.id} className={contractStyles['contract-list-item']}>
              <FileText size={22} aria-hidden />
              <div className={contractStyles['contract-list-copy']}>
                <Space wrap>{contract.title}{statusTag(contract.status)}</Space>
                <Typography.Text type="secondary">管理员：{contract.issuer.displayName || contract.issuer.username} · 发起于 {contract.issuedAt ? new Date(contract.issuedAt).toLocaleString() : '草稿中'}</Typography.Text>
              </div>
              {contract.credentials.some((credential) => credential.status === 2) ? <Tag icon={<BadgeCheck size={12} />} color="success">已上链</Tag> : null}
              <Button type="link" onClick={() => setSelected(contract)}>{contract.status === 1 ? '阅读并签约' : '查看合同'}</Button>
            </li>)}
          </ul> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无分配给您的合同" />}
          {(contracts.data?.total || 0) > 20 ? <Pagination className={contractStyles.pagination} current={page} pageSize={20} total={contracts.data?.total} showSizeChanger={false} onChange={setPage} /> : null}
        </AccountCard>
    )}

    <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} size={760} title="合同详情">
      {selectedContract.isError ? <AccountQueryError retry={() => void selectedContract.refetch()} /> : selectedContract.isPending ? <Typography.Text>正在加载合同…</Typography.Text> : selectedContract.data ? <ContractRead contract={selectedContract.data} onSign={() => { setAcknowledged(false); setSigning(selectedContract.data) }} onDecline={() => { declineForm.resetFields(); setDeclining(selectedContract.data) }} /> : null}
    </Drawer>
    <Modal open={Boolean(signing)} title="确认在线签约" okText="确认签约" cancelText="返回阅读" confirmLoading={sign.isPending} okButtonProps={{ disabled: !acknowledged }} onCancel={() => { if (!sign.isPending) setSigning(null) }} onOk={() => signing && sign.mutate(signing.id)}>
      <Space orientation="vertical" size={14} style={{ width: '100%' }}>
        <Alert type="warning" showIcon title={signing?.title || '确认签约'} description="请核对正文、附件、开发范围、费用与交付约定。确认后会记录您的签约结果，无法撤回；如需修改，请先联系管理员。" />
        <Checkbox checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)}>我已阅读合同正文及附件，同意上述条款并确认签约。</Checkbox>
      </Space>
    </Modal>
    <Modal open={Boolean(declining)} title="拒绝签约" okText="确认拒签" okButtonProps={{ danger: true }} cancelText="返回" confirmLoading={decline.isPending} onCancel={() => { if (!decline.isPending) setDeclining(null) }} onOk={() => declineForm.submit()}>
      <Form form={declineForm} layout="vertical" onFinish={(values) => decline.mutate(values)}><Form.Item name="reason" label="拒签原因（可选）"><Input.TextArea rows={4} maxLength={500} showCount /></Form.Item></Form>
    </Modal>
  </div>
}

function ContractRead({ contract, onSign, onDecline }: { contract: Contract; onSign: () => void; onDecline: () => void }) {
  const credential = contract.credentials.find((item) => item.status === 2) || contract.credentials[0]
  return <div className={contractStyles.detail}>
    <section className={contractStyles.paper}>
      <div className={contractStyles['paper-header']}><FileCheck2 size={18} /><div><Typography.Text type="secondary">合同正文</Typography.Text><Typography.Title level={3}>{contract.title}</Typography.Title></div></div>
      <Descriptions column={1} size="small" items={[
        { key: 'issuer', label: '发起方', children: contract.issuer.displayName || contract.issuer.username },
        { key: 'subject', label: '签约账户', children: `${contract.subject.displayName || contract.subject.username}（@${contract.subject.username}）` },
        { key: 'status', label: '签约状态', children: statusTag(contract.status) },
        { key: 'attachment', label: 'PDF 附件', children: contract.attachment ? <a href={`/api/account/contracts/${contract.id}/attachment`} target="_blank" rel="noreferrer">{contract.attachment.originalName}</a> : '无' },
        { key: 'evidence', label: '链上存证', children: credential?.status === 2 && credential.transactionSignature ? <a href={`/contract-evidence/${credential.transactionSignature}`} target="_blank" rel="noreferrer">{credential.network === 'mainnet' ? '查看 Mainnet 凭证' : '查看 Devnet 测试凭证'}</a> : credential?.status === 1 ? '链上确认中' : credential?.status === -1 ? '存证未完成，等待管理员处理' : '可由管理员另行办理' },
      ]} />
      <div className={contractStyles.body}><MarkdownView content={contract.body} /></div>
      <details className={contractStyles.verification}><summary>合同编号与防篡改校验信息</summary><Descriptions column={1} size="small" items={[
        { key: 'id', label: '合同编号', children: <Typography.Text copyable>{contract.contractId}</Typography.Text> },
        { key: 'body', label: '正文 SHA-256', children: <Typography.Text code copyable>{contract.bodyHash}</Typography.Text> },
        { key: 'root', label: '合同根哈希', children: contract.contractHash ? <Typography.Text code copyable>{contract.contractHash}</Typography.Text> : '签约后生成' },
      ]} /></details>
    </section>
    {contract.status === -1 ? <Alert type="info" showIcon title="您已拒签" description={contract.declineReason || '如需调整条款，请联系管理员重新发起合同。'} /> : null}
    {contract.status === -2 ? <Alert type="info" showIcon title="管理员已取消此合同" description="此合同已结束，无需签约；如需继续合作，请联系管理员。" /> : null}
    {contract.status === 1 ? <div className={contractStyles['user-actions']}><Button type="primary" icon={<PenLine size={15} />} onClick={onSign}>阅读完毕，在线签约</Button><Button danger icon={<XCircle size={15} />} onClick={onDecline}>拒绝签约</Button></div> : null}
    {contract.status === 2 ? <Alert type="success" showIcon icon={<ShieldCheck />} title={`已于 ${contract.signedAt ? new Date(contract.signedAt).toLocaleString() : ''} 完成在线签约`} description="您可随时查看合同与下载附件。后续如需链上存证，由管理员另行办理。" /> : null}
  </div>
}
