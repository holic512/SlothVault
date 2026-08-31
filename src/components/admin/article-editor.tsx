'use client'

/**
 * @file article-editor.tsx
 * @project SlothVault
 * @module Independent Article Editor
 * @description Provides a focused administrator workspace for article metadata, optional cover, Markdown body, and publication lifecycle.
 * @logic Hydrate existing drafts, persist edits before lifecycle transitions, upload managed cover/body images, and allow published articles to update in place.
 * @dependencies Ant Design, React Query, Next navigation, MarkdownContentEditor, article and file APIs
 * @index_tags admin,article,editor,markdown,cover,publish
 * @author holic512
 */
import { useEffect, useRef, useState } from 'react'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Alert, Button, Input, Select, Skeleton, Space, Tag, Typography } from 'antd'
import { ArrowLeft, EyeOff, ImagePlus, Rocket, Save, Trash2, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { AdminPage } from '@/components/admin/admin-page'
import { MarkdownContentEditor } from '@/components/admin/markdown-content-editor'
import { ArticleCover } from '@/components/article/article-cover'
import { formatAdminDate, formatAdminError } from '@/lib/admin-localization'
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

type UploadedFile = { url: string | null }

type MembershipLevel = {
  id: string
  name: string
  rank: number
  status: number
}

export function ArticleEditor({ articleId }: { articleId?: string }) {
  const t = useTranslations('AdminMM.articles.editor')
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const coverInput = useRef<HTMLInputElement>(null)
  const hydratedId = useRef<string | null>(null)
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [cover, setCover] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [requiredMembershipLevelId, setRequiredMembershipLevelId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)

  const query = useQuery({
    queryKey: ['admin-article', articleId],
    enabled: Boolean(articleId),
    queryFn: () => apiFetch<ArticleDto>(`/api/admin/mm/article/${articleId}`),
  })
  const article = query.data
  const membershipLevelsQuery = useQuery({
    queryKey: ['admin-membership-levels'],
    queryFn: () => apiFetch<MembershipLevel[]>('/api/admin/mm/membership-levels?includeDisabled=1'),
  })

  useEffect(() => {
    if (!article || hydratedId.current === article.id) return
    hydratedId.current = article.id
    setTitle(article.title)
    setSummary(article.summary || '')
    setCover(article.cover)
    setContent(article.content)
    setRequiredMembershipLevelId(article.requiredMembershipLevelId)
    setDirty(false)
  }, [article])

  useEffect(() => {
    const preventLeave = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', preventLeave)
    return () => window.removeEventListener('beforeunload', preventLeave)
  }, [dirty])

  const mark = <T,>(setter: (value: T) => void, value: T) => {
    setter(value)
    setDirty(true)
  }

  const uploadFiles = async (files: File[], businessType: 'ArticleCover' | 'ArticleAttachment') => {
    const formData = new FormData()
    files.forEach((file) => formData.append('file', file))
    return apiFetch<UploadedFile[]>(`/api/admin/mm/file?businessType=${businessType}`, {
      method: 'POST',
      body: formData,
    })
  }

  const uploadCover = async (file: File) => {
    setBusy(true)
    try {
      const [uploaded] = await uploadFiles([file], 'ArticleCover')
      if (!uploaded?.url) throw new Error(t('messages.coverFailed'))
      mark(setCover, uploaded.url)
    } catch (error) {
      message.error(formatAdminError(error, errorT))
    } finally {
      setBusy(false)
      if (coverInput.current) coverInput.current.value = ''
    }
  }

  const persist = async () => {
    if (!title.trim()) {
      message.error(t('messages.titleRequired'))
      return null
    }
    setBusy(true)
    try {
      const saved = await apiFetch<ArticleDto>(
        articleId ? `/api/admin/mm/article/${articleId}` : '/api/admin/mm/article',
        {
          method: articleId ? 'PUT' : 'POST',
          body: JSON.stringify({
            title: title.trim(),
            summary: summary.trim() || null,
            cover,
            content,
            requiredMembershipLevelId: requiredMembershipLevelId ? Number(requiredMembershipLevelId) : null,
          }),
        },
      )
      setDirty(false)
      hydratedId.current = saved.id
      await queryClient.invalidateQueries({ queryKey: ['admin-articles'] })
      message.success(t('messages.saved'))
      if (!articleId) router.replace(`/admin/mm/articles/${saved.id}`)
      return saved
    } catch (error) {
      message.error(formatAdminError(error, errorT))
      return null
    } finally {
      setBusy(false)
    }
  }

  const runLifecycle = async (action: 'publish' | 'withdraw') => {
    const saved = dirty || !articleId ? await persist() : article
    if (!saved) return
    setBusy(true)
    try {
      const updated = await apiFetch<ArticleDto>(`/api/admin/mm/article/${saved.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      queryClient.setQueryData(['admin-article', saved.id], updated)
      await queryClient.invalidateQueries({ queryKey: ['admin-articles'] })
      message.success(t(`messages.${action}Success`))
    } catch (error) {
      message.error(formatAdminError(error, errorT))
    } finally {
      setBusy(false)
    }
  }

  const remove = () => {
    if (!articleId || !article) return
    modal.confirm({
      title: t('messages.deleteTitle'),
      content: t('messages.deleteConfirm'),
      okText: t('delete'),
      okButtonProps: { danger: true },
      onOk: async () => {
        await apiFetch(`/api/admin/mm/article/${articleId}`, { method: 'DELETE' })
        await queryClient.invalidateQueries({ queryKey: ['admin-articles'] })
        router.replace('/admin/mm/articles')
      },
    })
  }

  if (articleId && query.isLoading) {
    return (
      <AdminPage>
        <div className="admin-editor-loading"><Skeleton active /></div>
      </AdminPage>
    )
  }
  if (articleId && query.isError) {
    return <AdminPage><Alert type="error" showIcon message={formatAdminError(query.error, errorT)} /></AdminPage>
  }
  if (article?.isDeleted) {
    return (
      <AdminPage>
        <Alert type="warning" showIcon message={t('deletedTitle')} description={t('deletedDescription')} />
      </AdminPage>
    )
  }

  const published = article?.status === 1
  return (
    <div className="article-editor-workspace">
      <header className="article-editor-toolbar">
        <Space size={6}>
          <Button icon={<ArrowLeft size={15} />} onClick={() => router.push('/admin/mm/articles')}>{t('back')}</Button>
          <Tag color={published ? 'green' : 'gold'}>{published ? t('published') : t('draft')}</Tag>
          {dirty ? <Typography.Text type="warning">{t('unsaved')}</Typography.Text> : null}
        </Space>
        <Space size={6} wrap>
          {articleId ? <Button danger icon={<Trash2 size={15} />} onClick={remove}>{t('delete')}</Button> : null}
          {published ? (
            <Button icon={<EyeOff size={15} />} loading={busy} onClick={() => void runLifecycle('withdraw')}>{t('withdraw')}</Button>
          ) : (
            <Button icon={<Rocket size={15} />} loading={busy} onClick={() => void runLifecycle('publish')}>{t('publish')}</Button>
          )}
          <Button type="primary" icon={<Save size={15} />} loading={busy} disabled={!dirty && Boolean(articleId)} onClick={() => void persist()}>{t('save')}</Button>
        </Space>
      </header>

      <div className="article-editor-layout">
        <aside className="article-editor-meta">
          <div className="article-editor-field">
            <label htmlFor="article-title">{t('title')}</label>
            <Input id="article-title" value={title} maxLength={255} showCount onChange={(event) => mark(setTitle, event.target.value)} />
          </div>
          <div className="article-editor-field">
            <label htmlFor="article-summary">{t('summary')}</label>
            <Input.TextArea id="article-summary" value={summary} maxLength={500} showCount autoSize={{ minRows: 4, maxRows: 8 }} onChange={(event) => mark(setSummary, event.target.value)} />
            <Typography.Text type="secondary">{t('summaryHint')}</Typography.Text>
          </div>
          <div className="article-editor-field">
            <label htmlFor="article-membership-level">{t('access')}</label>
            <Select
              id="article-membership-level"
              allowClear
              value={requiredMembershipLevelId || undefined}
              placeholder={t('publicAccess')}
              loading={membershipLevelsQuery.isLoading}
              options={(membershipLevelsQuery.data || []).map((level) => ({
                value: level.id,
                label: `Lv.${level.rank} · ${level.name}${level.status === 0 ? ` (${t('levelDisabled')})` : ''}`,
              }))}
              onChange={(value) => mark(setRequiredMembershipLevelId, value || null)}
            />
            <Typography.Text type="secondary">{requiredMembershipLevelId ? t('memberOnlyHint') : t('publicAccessHint')}</Typography.Text>
          </div>
          <div className="article-editor-field">
            <label>{t('cover')}</label>
            <ArticleCover cover={cover} title={title || t('coverFallback')} className="article-editor-cover" />
            <input
              ref={coverInput}
              hidden
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void uploadCover(file)
              }}
            />
            <Space size={6}>
              <Button icon={<ImagePlus size={15} />} loading={busy} onClick={() => coverInput.current?.click()}>{cover ? t('replaceCover') : t('uploadCover')}</Button>
              {cover ? <Button icon={<X size={14} />} onClick={() => mark(setCover, null)}>{t('removeCover')}</Button> : null}
            </Space>
          </div>
          {published && article?.publishedAt ? (
            <div className="article-editor-publication">
              <span>{t('firstPublished')}</span>
              <strong>{formatAdminDate(locale, article.publishedAt)}</strong>
              <a href={`/articles/${article.id}`} target="_blank" rel="noreferrer">{t('viewPublic')}</a>
            </div>
          ) : null}
        </aside>

        <main className="article-editor-body">
          <MarkdownContentEditor
            value={content}
            onChange={(value) => mark(setContent, value)}
            onUpload={async (files) => {
              const uploaded = await uploadFiles(files, 'ArticleAttachment')
              return uploaded.flatMap((item) => item.url ? [item.url] : [])
            }}
            fillContainer
            header={<div><strong>{t('body')}</strong><span>{t('bodyHint')}</span></div>}
          />
        </main>
      </div>
    </div>
  )
}
