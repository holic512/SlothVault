/**
 * @file evidence-page.tsx
 * @project SlothVault
 * @module Commission evidence queue
 * @description Administrator queue for mandatory evidence, with the original stage workspace one click away.
 * @logic Show only unresolved frozen actions, separate operational failures from ordinary audit records, and never expose a network switch.
 * @dependencies React, plugin client SDK, commissions DTOs
 * @index_tags commissions,evidence,queue
 * @author holic512
 */
import { useState } from 'react'
import { Button, Empty, PluginPage, PluginTablePanel, Select, Table, useQuery } from '@slothvault/plugin-sdk/client'
import { API, type FrozenAction } from './domain'
import { AdminNavigation, ErrorNotice, Status, evidenceNames, get, kindNames, pageUrl, queryRoot, useDate } from './ui'
type QueueItem = { commissionId: string; title: string; evidence: FrozenAction }
export default function EvidencePage() {
  const [status, setStatus] = useState(''),
    date = useDate()
  const query = useQuery({
    queryKey: [...queryRoot, 'evidence'],
    queryFn: () => get<{ list: QueueItem[] }>(API.evidence),
    refetchInterval: 12000
  })
  const rows = (query.data?.list ?? []).filter(item => !['FINALIZED', 'WITHDRAWN'].includes(item.evidence.status) && (!status || item.evidence.status === status))
  return <PluginPage className="commissions">
    <AdminNavigation current="evidence" />
    <header className="commission-heading">
      <div><h1>存证待办</h1><p>仅显示必须完成存证的需求、合同、确认及正式交付。普通沟通与付款更新不需要逐条签名。</p></div>
      <Button onClick={() => {
        void query.refetch()
      }} loading={query.isFetching}>刷新状态</Button>
    </header>
    <Select
      className="commission-status-filter"
      aria-label="筛选存证状态"
      value={status}
      onChange={setStatus}
      options={[
        { value: '', label: '全部待办状态' },
        ...Object.entries(evidenceNames).filter(([value]) => !['FINALIZED', 'WITHDRAWN'].includes(value)).map(([value, label]) => ({ value, label }))
      ]}
    />
    <ErrorNotice error={query.error} retry={() => {
      void query.refetch()
    }} />
    <PluginTablePanel>
      <Table<QueueItem>
        rowKey={item => item.evidence.id}
        loading={query.isPending}
        dataSource={rows}
        scroll={{ x: 720 }}
        pagination={{ pageSize: 12, hideOnSinglePage: true }}
        locale={{ emptyText: <Empty description="当前没有需要办理的存证；无需为普通沟通记录重复签名。" /> }}
        columns={[
          {
            title: '委托',
            key: 'title',
            render: (_, item) => <a href={pageUrl(true, 'admin', { commissionId: item.commissionId })}>{item.title}</a>
          },
          { title: '待生效步骤', key: 'kind', render: (_, item) => kindNames[item.evidence.kind] },
          {
            title: '存证状态',
            key: 'status',
            render: (_, item) => <Status evidence value={item.evidence.status} />
          },
          { title: '提交时间', key: 'created', render: (_, item) => date(item.evidence.createdAt) },
          {
            title: '办理',
            key: 'action',
            render: (_, item) => <Button href={pageUrl(true, 'admin', { commissionId: item.commissionId })}>
              {item.evidence.status === 'SUBMITTED' ? '回到步骤核对交易' : '回到步骤办理存证'}
            </Button>
          },
        ]}
      />
    </PluginTablePanel>
  </PluginPage>
}
