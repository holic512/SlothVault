'use client'

/**
 * @file trash-manager.tsx
 * @project SlothVault
 * @module Administrator Trash Workspace
 * @description Presents deleted articles and a lazy project hierarchy with read-only previews and controlled restoration.
 * @logic Paginate roots, expand hierarchy on demand, distinguish frozen and inherited states, and refresh active pages after restoration.
 * @dependencies React Query, Ant Design, administrator trash API, sanitized Markdown viewer
 * @index_tags admin,trash,articles,projects,tree,preview
 * @author holic512
 */
import { useMemo, useState } from 'react'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Empty, Input, Modal, Pagination, Space, Spin, Table, Tabs, Tag, Tree, Typography } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { Eye, RotateCcw } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { AdminPage } from '@/components/admin/admin-page'
import { MarkdownView } from '@/components/markdown/markdown-view'
import { formatAdminDate, formatAdminError } from '@/lib/admin-localization'
import { apiFetch } from '@/lib/api-client'

type Kind = 'article' | 'project' | 'version' | 'category' | 'note' | 'content' | 'home' | 'menu'
type Node = {
  key: string
  kind: Kind
  id: string
  label: string
  isDeleted: boolean
  deletedAt: string | null
  hiddenByParent: boolean
  frozen: boolean
  hasChildren: boolean
  children?: Node[]
}
type Article = { id: string; title: string; summary: string | null; deletedAt: string | null; publishedAt: string | null }
type Page<T> = { list: T[]; page: number; pageSize: number; total: number }
type Preview = { title?: string; summary?: string | null; content: string; isDeleted: boolean; deletedAt: string | null }

function findPath(nodes: Node[], key: string, ancestors: Node[] = []): Node[] {
  for (const item of nodes) {
    if (item.key === key) return [...ancestors, item]
    const path = findPath(item.children || [], key, [...ancestors, item])
    if (path.length) return path
  }
  return []
}

export function TrashManager() {
  const t = useTranslations('AdminMM.trash')
  const errors = useTranslations('AdminMM.errors')
  const locale = useLocale()
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'articles' | 'projects'>('articles')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loadedChildren, setLoadedChildren] = useState<Record<string, Node[]>>({})
  const [treeRevision, setTreeRevision] = useState(0)
  const [selected, setSelected] = useState<Node | null>(null)
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null)
  const [busy, setBusy] = useState(false)

  const listing = useQuery({
    queryKey: ['admin-trash', tab, page, pageSize, keyword],
    queryFn: () => apiFetch<Page<Node | Article>>(`/api/admin/mm/trash?tab=${tab}&page=${page}&pageSize=${pageSize}&keyword=${encodeURIComponent(keyword)}`),
  })
  const nodes = useMemo(() => {
    const hydrate = (items: Node[]): Node[] => items.map((item) => ({
      ...item,
      ...(loadedChildren[item.key] ? { children: hydrate(loadedChildren[item.key]) } : {}),
    }))
    return tab === 'projects' ? hydrate((listing.data?.list || []) as Node[]) : []
  }, [listing.data, loadedChildren, tab])

  const previewTarget = tab === 'articles'
    ? selectedArticle ? { kind: 'article' as Kind, id: selectedArticle.id } : null
    : selected && ['content', 'home', 'menu'].includes(selected.kind) ? { kind: selected.kind, id: selected.id } : null
  const preview = useQuery({
    queryKey: ['admin-trash-preview', previewTarget?.kind, previewTarget?.id],
    enabled: Boolean(previewTarget),
    queryFn: () => apiFetch<Preview>(`/api/admin/mm/trash/${previewTarget!.kind}/${previewTarget!.id}`),
  })

  const path = selected ? findPath(nodes, selected.key) : []
  const treeData = useMemo<DataNode[]>(() => {
    const convert = (items: Node[]): DataNode[] => items.map((item) => ({
      key: item.key,
      isLeaf: !item.hasChildren,
      title: <Space size={4} wrap>
        <span>{item.label}</span>
        {item.isDeleted ? <Tag color="error">{t('deleted')}</Tag> : item.hiddenByParent ? <Tag>{t('inherited')}</Tag> : null}
        {item.frozen ? <Tag color="blue">{t('frozen')}</Tag> : null}
      </Space>,
      children: item.children ? convert(item.children) : undefined,
    }))
    return convert(nodes)
  }, [nodes, t])

  const restore = (kind: Kind, id: string, label: string) => {
    modal.confirm({
      title: t('restoreTitle'),
      content: kind === 'project' || (selected && path.some((item) => item.kind === 'project' && item.isDeleted))
        ? t('restoreProjectWarning', { name: label }) : t('restoreConfirm', { name: label }),
      okText: t('restore'),
      onOk: async () => {
        setBusy(true)
        try {
          await apiFetch(`/api/admin/mm/trash/${kind}/${id}`, { method: 'POST' })
          setSelected(null)
          setSelectedArticle(null)
          setLoadedChildren({})
          setTreeRevision((current) => current + 1)
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['admin-trash'] }),
            queryClient.invalidateQueries({ queryKey: ['admin-projects'] }),
            queryClient.invalidateQueries({ queryKey: ['admin-articles'] }),
            queryClient.invalidateQueries({ queryKey: ['admin-note-workspace'] }),
          ])
          message.success(t('restored'))
        } catch (error) {
          message.error(formatAdminError(error, errors))
        } finally {
          setBusy(false)
        }
      },
    })
  }

  return <AdminPage>
    <Tabs activeKey={tab} onChange={(value) => { setTab(value as typeof tab); setPage(1); setSelected(null); setSelectedArticle(null); setLoadedChildren({}) }} items={[
      { key: 'articles', label: t('articles') }, { key: 'projects', label: t('projects') },
    ]} />
    <Input.Search allowClear value={keyword} placeholder={t('search')} onChange={(event) => { setKeyword(event.target.value); setPage(1); setSelected(null); setLoadedChildren({}); setTreeRevision((current) => current + 1) }} />
    {listing.isError ? <Typography.Text type="danger">{formatAdminError(listing.error, errors)}</Typography.Text> : null}
    {tab === 'articles' ? <Table<Article>
      rowKey="id" loading={listing.isLoading} dataSource={(listing.data?.list || []) as Article[]} scroll={{ x: 640 }}
      pagination={{ current: page, pageSize, total: listing.data?.total || 0, showSizeChanger: true, onChange: (nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); setSelectedArticle(null) } }}
      columns={[
        { title: t('name'), dataIndex: 'title' },
        { title: t('deletedAt'), dataIndex: 'deletedAt', render: (value: string | null) => value ? formatAdminDate(locale, value) : t('unknown') },
        { title: t('actions'), render: (_value, item) => <Space><Button icon={<Eye size={14} />} onClick={() => setSelectedArticle(item)}>{t('preview')}</Button><Button icon={<RotateCcw size={14} />} onClick={() => restore('article', item.id, item.title)}>{t('restore')}</Button></Space> },
      ]}
    /> : <div className="trash-layout">
      <section className="trash-tree">
        {listing.isLoading ? <Spin /> : nodes.length ? <Tree key={treeRevision}
          treeData={treeData} selectedKeys={selected ? [selected.key] : []}
          onSelect={(keys) => setSelected(findPath(nodes, String(keys[0])).at(-1) || null)}
          loadData={async (item) => {
            const target = findPath(nodes, String(item.key)).at(-1)
            if (!target || !target.hasChildren) return
            try {
              const children = await apiFetch<Node[]>(`/api/admin/mm/trash/${target.kind}/${target.id}?view=children`)
              setLoadedChildren((current) => ({ ...current, [target.key]: children }))
            } catch (error) {
              message.error(formatAdminError(error, errors))
              throw error
            }
          }}
        /> : <Empty description={t('empty')} />}
        <Pagination current={page} pageSize={pageSize} total={listing.data?.total || 0} onChange={(nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); setSelected(null); setLoadedChildren({}); setTreeRevision((current) => current + 1) }} showSizeChanger />
      </section>
      <section className="trash-detail">
        {selected ? <>
          <Typography.Title level={4}>{selected.label}</Typography.Title>
          <Typography.Paragraph type="secondary">{path.map((item) => item.label).join(' / ')}</Typography.Paragraph>
          <Space wrap>
            {selected.isDeleted ? <Tag color="error">{t('deleted')}</Tag> : selected.hiddenByParent ? <Tag>{t('inherited')}</Tag> : null}
            {selected.frozen ? <Tag color="blue">{t('frozen')}</Tag> : null}
          </Space>
          <Typography.Paragraph>{t('deletedAt')}: {selected.deletedAt ? formatAdminDate(locale, selected.deletedAt) : selected.isDeleted ? t('unknown') : '—'}</Typography.Paragraph>
          {(selected.isDeleted || selected.hiddenByParent) && !selected.frozen ? <Button loading={busy} icon={<RotateCcw size={14} />} onClick={() => restore(selected.kind, selected.id, selected.label)}>{t('restore')}</Button> : null}
          {selected.frozen && selected.hiddenByParent ? <Typography.Paragraph type="secondary">{t('frozenDescription')}</Typography.Paragraph> : null}
          {preview.isError ? <Typography.Text type="danger">{formatAdminError(preview.error, errors)}</Typography.Text> : null}
          {preview.isLoading ? <Spin /> : preview.data?.content !== undefined ? selected.kind === 'menu'
            ? <Typography.Text code>{preview.data.content || '—'}</Typography.Text>
            : <MarkdownView content={preview.data.content} /> : null}
        </> : <Empty description={t('select')} />}
      </section>
    </div>}
    {tab === 'articles' && selectedArticle ? <Modal open title={selectedArticle.title} footer={[
      <Button key="close" onClick={() => setSelectedArticle(null)}>{t('close')}</Button>,
      <Button key="restore" loading={busy} onClick={() => restore('article', selectedArticle.id, selectedArticle.title)}>{t('restore')}</Button>,
    ]} onCancel={() => setSelectedArticle(null)} width={820}>
      {preview.isError ? <Typography.Text type="danger">{formatAdminError(preview.error, errors)}</Typography.Text> : null}
      {preview.isLoading ? <Spin /> : preview.data ? <>
        <Typography.Paragraph>{t('deletedAt')}: {selectedArticle.deletedAt ? formatAdminDate(locale, selectedArticle.deletedAt) : t('unknown')}</Typography.Paragraph>
        <MarkdownView content={preview.data.content} />
      </> : null}
    </Modal> : null}
  </AdminPage>
}
