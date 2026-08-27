'use client'

/**
 * @file articles-manager.tsx
 * @project SlothVault
 * @module Independent Article Administration
 * @description Provides the administrator archive for searching, publishing, withdrawing, restoring, and soft-deleting standalone blog articles.
 * @logic Keep article lifecycle actions explicit, preserve pagination filters, and route all body editing into the dedicated article workspace.
 * @dependencies Ant Design, React Query, next-intl, Next navigation, article administration API
 * @index_tags admin,article,blog,list,lifecycle
 * @author holic512
 */
import { useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Input, Select, Space, Switch, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { EyeOff, FilePenLine, Plus, RefreshCw, Rocket, RotateCcw, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { AdminPage, AdminPageActions, AdminTablePanel } from '@/components/admin/admin-page'
import { apiFetch } from '@/lib/api-client'

type ArticleDto = {
  id: string
  title: string
  summary: string | null
  cover: string | null
  content: string
  status: number
  requiredMembershipLevelId: string | null
  requiredMembershipLevel: { id: string; name: string; rank: number } | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

type ArticleListData = {
  list: ArticleDto[]
  page: number
  pageSize: number
  total: number
}

export function ArticlesManager() {
  const t = useTranslations('AdminMM.articles')
  const router = useRouter()
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<string>()
  const [includeDeleted, setIncludeDeleted] = useState(false)

  const query = useQuery({
    queryKey: ['admin-articles', page, pageSize, keyword, status, includeDeleted],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (keyword.trim()) params.set('keyword', keyword.trim())
      if (status !== undefined) params.set('status', status)
      if (includeDeleted) params.set('includeDeleted', '1')
      return apiFetch<ArticleListData>(`/api/admin/mm/article?${params}`)
    },
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-articles'] })
  const lifecycle = useMutation({
    mutationFn: async ({ article, action }: { article: ArticleDto; action: 'publish' | 'withdraw' | 'restore' | 'delete' }) => {
      if (action === 'delete') {
        return apiFetch<ArticleDto>(`/api/admin/mm/article/${article.id}`, { method: 'DELETE' })
      }
      if (action === 'restore') {
        return apiFetch<ArticleDto>(`/api/admin/mm/article/${article.id}`, {
          method: 'PUT',
          body: JSON.stringify({ isDeleted: false }),
        })
      }
      return apiFetch<ArticleDto>(`/api/admin/mm/article/${article.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
    },
    onSuccess: async (_data, variables) => {
      message.success(t(`messages.${variables.action}Success`))
      await refresh()
    },
    onError: (error) => message.error(error.message),
  })

  const confirmDelete = (article: ArticleDto) => {
    modal.confirm({
      title: t('messages.deleteTitle'),
      content: t('messages.deleteConfirm', { title: article.title }),
      okText: t('actions.delete'),
      cancelText: t('actions.cancel'),
      okButtonProps: { danger: true },
      onOk: () => lifecycle.mutateAsync({ article, action: 'delete' }),
    })
  }

  const columns: ColumnsType<ArticleDto> = [
    {
      title: t('table.article'),
      dataIndex: 'title',
      render: (_value, row) => (
        <div className="admin-article-cell">
          <span className="admin-article-thumb">
            {row.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.cover} alt="" />
            ) : row.title.charAt(0)}
          </span>
          <span>
            <Typography.Text strong>{row.title}</Typography.Text>
            <Typography.Text type="secondary" ellipsis>{row.summary || t('table.noSummary')}</Typography.Text>
          </span>
        </div>
      ),
    },
    {
      title: t('table.status'),
      dataIndex: 'status',
      width: 120,
      render: (_value, row) => row.isDeleted
        ? <Tag>{t('status.deleted')}</Tag>
        : row.status === 1
          ? <Tag color="green">{t('status.published')}</Tag>
          : <Tag color="gold">{t('status.draft')}</Tag>,
    },
    {
      title: t('table.access'),
      dataIndex: 'requiredMembershipLevel',
      width: 150,
      render: (value: ArticleDto['requiredMembershipLevel']) => value
        ? <Tag color="gold">Lv.{value.rank} · {value.name}</Tag>
        : <Tag color="green">{t('table.public')}</Tag>,
    },
    {
      title: t('table.publishedAt'),
      dataIndex: 'publishedAt',
      width: 150,
      render: (value) => value ? new Date(value).toLocaleDateString() : '-',
    },
    {
      title: t('table.updatedAt'),
      dataIndex: 'updatedAt',
      width: 170,
      render: (value) => new Date(value).toLocaleString(),
    },
    {
      title: t('table.operations'),
      fixed: 'right',
      width: 280,
      render: (_value, row) => (
        <Space size={2} wrap>
          {!row.isDeleted ? (
            <Button type="link" icon={<FilePenLine size={14} />} onClick={() => router.push(`/admin/mm/articles/${row.id}`)}>
              {t('actions.edit')}
            </Button>
          ) : null}
          {!row.isDeleted && row.status === 0 ? (
            <Button type="link" icon={<Rocket size={14} />} onClick={() => lifecycle.mutate({ article: row, action: 'publish' })}>
              {t('actions.publish')}
            </Button>
          ) : null}
          {!row.isDeleted && row.status === 1 ? (
            <Button type="link" icon={<EyeOff size={14} />} onClick={() => lifecycle.mutate({ article: row, action: 'withdraw' })}>
              {t('actions.withdraw')}
            </Button>
          ) : null}
          {row.isDeleted ? (
            <Button type="link" icon={<RotateCcw size={14} />} onClick={() => lifecycle.mutate({ article: row, action: 'restore' })}>
              {t('actions.restore')}
            </Button>
          ) : (
            <Button type="link" danger icon={<Trash2 size={14} />} onClick={() => confirmDelete(row)}>
              {t('actions.delete')}
            </Button>
          )}
        </Space>
      ),
    },
  ]

  return (
    <AdminPage>
      <AdminPageActions>
        <Space>
          <Button icon={<RefreshCw size={15} />} loading={query.isFetching} onClick={() => void refresh()}>{t('actions.refresh')}</Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={() => router.push('/admin/mm/articles/new')}>{t('actions.create')}</Button>
        </Space>
      </AdminPageActions>

      <div className="admin-toolbar-card">
        <div className="admin-filters">
          <Input.Search
            allowClear
            value={keyword}
            placeholder={t('filters.keyword')}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={() => setPage(1)}
          />
          <Select
            allowClear
            value={status}
            placeholder={t('filters.status')}
            onChange={(value) => { setStatus(value); setPage(1) }}
            options={[
              { label: t('status.draft'), value: '0' },
              { label: t('status.published'), value: '1' },
            ]}
          />
          <label className="admin-switch-label">
            <Switch checked={includeDeleted} onChange={(value) => { setIncludeDeleted(value); setPage(1) }} />
            {t('filters.includeDeleted')}
          </label>
        </div>
      </div>

      <AdminTablePanel>
        <Table
          rowKey="id"
          loading={query.isLoading}
          dataSource={query.data?.list || []}
          columns={columns}
          scroll={{ x: 960 }}
          pagination={{
            current: page,
            pageSize,
            total: query.data?.total || 0,
            showSizeChanger: true,
            onChange: (nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize) },
          }}
        />
      </AdminTablePanel>
    </AdminPage>
  )
}
