'use client'

/**
 * @file homepage-editor.tsx
 * @project SlothVault
 * @module Homepage Administration
 * @description Provides one React Markdown editing workflow and unified contextual toolbar for the system homepage and per-project homepages.
 * @logic Load an optional homepage record, create it on first save, debounce later updates, guard browser exits, upload embedded images, and supply save controls to the editor header.
 * @dependencies React Query, Ant Design, React MD Editor wrapper, next-intl, api-client
 * @index_tags admin,homepage,project-home,markdown,autosave
 * @author holic512
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Alert, Button, Skeleton, Space, Tag, Typography } from 'antd'
import { ArrowLeft, Save } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { AdminPage } from '@/components/admin/admin-page'
import { MarkdownContentEditor } from '@/components/admin/markdown-content-editor'
import { formatAdminDate, formatAdminError } from '@/lib/admin-localization'
import { ApiClientError, apiFetch } from '@/lib/api-client'

type HomepageDto = {
  id: string
  projectId?: string
  content: string
  status: number
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}
type ProjectDto = { id: string; projectName: string }
type UploadedFile = { url: string }

export function HomepageEditor({ projectId }: { projectId?: string }) {
  const t = useTranslations('AdminMM.homepage')
  const errorT = useTranslations('AdminMM.errors')
  const projectQuery = useQuery({
    queryKey: ['admin-project-home-project', projectId],
    enabled: Boolean(projectId),
    queryFn: () => apiFetch<ProjectDto>(`/api/admin/mm/project/${projectId}`),
  })
  const resourceQuery = useQuery({
    queryKey: ['admin-homepage-editor', projectId || 'system'],
    queryFn: async () => {
      try {
        return await apiFetch<HomepageDto>(
          projectId
            ? `/api/admin/mm/home?projectId=${projectId}`
            : '/api/admin/mm/systemHomepage',
        )
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 404) return null
        throw error
      }
    },
  })

  if (resourceQuery.isLoading || (projectId && projectQuery.isLoading)) {
    return (
      <AdminPage>
        <div className="admin-editor-loading"><Skeleton active paragraph={{ rows: 12 }} /></div>
      </AdminPage>
    )
  }
  if (resourceQuery.isError || projectQuery.isError) {
    return (
      <AdminPage>
        <Alert
          showIcon
          type="error"
          message={t('messages.loadFailed')}
          description={formatAdminError(resourceQuery.error || projectQuery.error, errorT)}
        />
      </AdminPage>
    )
  }

  return (
    <HomepageDraft
      key={`${projectId || 'system'}:${resourceQuery.data?.id || 'new'}`}
      projectId={projectId}
      projectName={projectQuery.data?.projectName}
      initialResource={resourceQuery.data || null}
    />
  )
}

function HomepageDraft({
  projectId,
  projectName,
  initialResource,
}: {
  projectId?: string
  projectName?: string
  initialResource: HomepageDto | null
}) {
  const t = useTranslations('AdminMM.homepage')
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
  const tDocument = useTranslations('DocumentEditor')
  const router = useRouter()
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [resource, setResource] = useState(initialResource)
  const [draft, setDraft] = useState(initialResource?.content || '')
  const [savedDraft, setSavedDraft] = useState(initialResource?.content || '')
  const [saving, setSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const draftRef = useRef(draft)
  const savingRef = useRef(false)

  const save = useCallback(
    async (silent = false) => {
      const contentToSave = draftRef.current
      if (savingRef.current || contentToSave === savedDraft) {
        if (!silent && contentToSave === savedDraft) message.info(t('messages.noChanges'))
        return
      }
      savingRef.current = true
      setSaving(true)
      try {
        const base = projectId ? '/api/admin/mm/home' : '/api/admin/mm/systemHomepage'
        const nextResource = await apiFetch<HomepageDto>(resource ? `${base}/${resource.id}` : base, {
          method: resource ? 'PUT' : 'POST',
          body: JSON.stringify(
            resource
              ? { content: contentToSave, status: 1, ...(projectId ? { isDeleted: false } : {}) }
              : { content: contentToSave, status: 1, ...(projectId ? { projectId } : {}) },
          ),
        })
        setResource(nextResource)
        setSavedDraft(contentToSave)
        setLastSavedAt(new Date())
        queryClient.setQueryData(
          ['admin-homepage-editor', projectId || 'system'],
          nextResource,
        )
        if (!silent) message.success(t('messages.saveSuccess'))
      } catch (error) {
        message.error(formatAdminError(error, errorT))
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    [errorT, message, projectId, queryClient, resource, savedDraft, t],
  )

  useEffect(() => {
    if (draft === savedDraft) return
    const timer = window.setTimeout(() => void save(true), 3000)
    return () => window.clearTimeout(timer)
  }, [draft, save, savedDraft])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 's') {
        event.preventDefault()
        void save(false)
      }
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (draftRef.current === savedDraft) return
      event.preventDefault()
    }
    window.addEventListener('keydown', handleKeydown)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('keydown', handleKeydown)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [save, savedDraft])

  const uploadImages = async (files: File[]) => {
    const formData = new FormData()
    files.forEach((file) => formData.append('file', file))
    try {
      const uploaded = await apiFetch<UploadedFile[]>('/api/admin/mm/file?businessType=Markdown', {
        method: 'POST',
        body: formData,
      })
      return uploaded.map((file) => file.url)
    } catch (error) {
      message.error(formatAdminError(error, errorT))
      return []
    }
  }

  const dirty = draft !== savedDraft
  return (
    <div className="managed-markdown-page">
      <MarkdownContentEditor
        value={draft}
        onChange={(value) => {
          draftRef.current = value
          setDraft(value)
        }}
        onUpload={uploadImages}
        fillContainer
        header={(
          <div className="managed-markdown-heading">
            {projectId ? (
              <Button
                type="text"
                icon={<ArrowLeft size={16} />}
                onClick={() => router.push('/admin/mm/projects')}
              />
            ) : null}
            <div>
              <Typography.Title level={4}>{projectName || t('title')}</Typography.Title>
              <Typography.Text type="secondary">{tDocument('title')}</Typography.Text>
            </div>
          </div>
        )}
        headerActions={(
          <Space size={6}>
            {dirty ? <Tag color="warning">{t('messages.unsaved')}</Tag> : null}
            {lastSavedAt ? (
              <Typography.Text type="secondary">{formatAdminDate(locale, lastSavedAt)}</Typography.Text>
            ) : null}
            <Typography.Text type="secondary">{t('messages.saveShortcut')}</Typography.Text>
            <Button
              type="primary"
              icon={<Save size={14} />}
              loading={saving}
              disabled={!dirty}
              onClick={() => void save(false)}
            >
              {t('actions.save')}
            </Button>
          </Space>
        )}
      />
    </div>
  )
}
