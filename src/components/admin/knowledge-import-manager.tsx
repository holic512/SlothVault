'use client'

/**
 * @file knowledge-import-manager.tsx
 * @project SlothVault
 * @module Knowledge Package Import Workspace
 * @description Provides the guided administrator flow for validating a Skill ZIP, choosing its project destination, and importing editable draft documents.
 * @logic Keep the package in browser memory during inspection and commit, derive the next required step from its validated kind, restrict article imports to visible drafts, and hand the user directly to the existing note editor after success.
 * @dependencies Ant Design, React Query, Next navigation, next-intl, api-client
 * @index_tags admin, knowledge-package, import, wizard, project-version, article
 * @author holic512
 */
import { useMemo, useState } from 'react'

import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  App,
  Button,
  Descriptions,
  Form,
  Select,
  Space,
  Steps,
  Tag,
  Upload,
} from 'antd'
import {
  Archive,
  BookOpenText,
  FileText,
  FolderTree,
  Import,
  ShieldCheck,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { AdminPage, AdminPageActions } from '@/components/admin/admin-page'
import { formatAdminBytes, formatAdminDate, formatAdminError } from '@/lib/admin-localization'
import { apiFetch } from '@/lib/api-client'
import importStyles from '@/styles/modules/knowledge-import.module.css'

type Project = { id: string; projectName: string; status: number; isDeleted: boolean }
type ProjectVersion = {
  id: string
  projectId: string
  version: string
  publishedAt: string | null
  isDeleted: boolean
}
type PreviewArticle = {
  id: string
  title: string
  articleType: string
  sourceReferenceCount: number
}
type PackagePreview = {
  kind: 'project' | 'article'
  projectName: string
  projectDescription: string
  title: string
  summary: string
  articleCount: number
  categories: Array<{ id: string; title: string; articleCount: number; articles: PreviewArticle[] }>
  archiveHash: string
  archiveBytes: number
  createdAt: string
}
type ImportResult = {
  projectVersionId: string
  version: string
  packageId: string
  noteId?: string
  articleCount: number
}

export function KnowledgeImportManager() {
  const t = useTranslations('AdminMM.knowledgeImport')
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
  const router = useRouter()
  const { message } = App.useApp()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PackagePreview | null>(null)
  const [projectId, setProjectId] = useState<string>()
  const [version, setVersion] = useState('')
  const [projectVersionId, setProjectVersionId] = useState<string>()
  const [inspecting, setInspecting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const projectsQuery = useQuery({
    queryKey: ['knowledge-import-projects'],
    queryFn: () => apiFetch<{ list: Project[] }>('/api/admin/mm/project?pageSize=100&status=1'),
  })
  const versionsQuery = useQuery({
    queryKey: ['knowledge-import-versions', projectId],
    enabled: Boolean(projectId),
    queryFn: () => apiFetch<{ list: ProjectVersion[] }>(
      `/api/admin/mm/projectVersion/byProject/${projectId}?pageSize=100`,
    ),
  })

  const draftVersions = useMemo(
    () => (versionsQuery.data?.list || []).filter((item) => !item.isDeleted && !item.publishedAt),
    [versionsQuery.data?.list],
  )
  const targetReady = Boolean(
    preview
      && projectId
      && (preview.kind === 'project' ? version.trim() : projectVersionId),
  )
  const currentStep = !preview ? 0 : !targetReady ? 1 : 2

  const chooseFile = (nextFile: File) => {
    setFile(nextFile)
    setPreview(null)
    setResult(null)
  }

  const chooseProject = (nextProjectId: string | undefined) => {
    setProjectId(nextProjectId)
    setProjectVersionId(undefined)
    setResult(null)
  }

  const inspect = async () => {
    if (!file) {
      message.warning(t('messages.selectPackage'))
      return
    }
    setInspecting(true)
    try {
      const formData = new FormData()
      formData.append('package', file)
      const inspected = await apiFetch<PackagePreview>('/api/admin/mm/knowledge-import/inspect', {
        method: 'POST',
        body: formData,
      })
      setPreview(inspected)
      setResult(null)
      message.success(t('messages.inspectSuccess'))
    } catch (error) {
      message.error(formatAdminError(error, errorT))
    } finally {
      setInspecting(false)
    }
  }

  const importPackage = async () => {
    if (!file || !preview) {
      message.warning(t('messages.selectPackage'))
      return
    }
    if (!projectId) {
      message.warning(t('messages.selectProject'))
      return
    }
    if (preview.kind === 'project' && !version.trim()) {
      message.warning(t('messages.selectVersion'))
      return
    }
    if (preview.kind === 'article' && !projectVersionId) {
      message.warning(t('messages.selectDraft'))
      return
    }

    setImporting(true)
    try {
      const formData = new FormData()
      formData.append('package', file)
      formData.append('projectId', projectId)
      if (preview.kind === 'project') formData.append('version', version.trim())
      else formData.append('projectVersionId', projectVersionId || '')
      const imported = await apiFetch<ImportResult>(
        `/api/admin/mm/knowledge-import/${preview.kind}`,
        { method: 'POST', body: formData },
      )
      setResult(imported)
      message.success(t('messages.importSuccess'))
    } catch (error) {
      message.error(formatAdminError(error, errorT))
    } finally {
      setImporting(false)
    }
  }

  const openWorkspace = () => {
    if (!result || !projectId) return
    if (result.noteId) {
      router.push(`/admin/mm/notes/${result.noteId}/content`)
      return
    }
    router.push(`/admin/mm/notes?projectId=${projectId}&versionId=${result.projectVersionId}`)
  }

  return (
    <AdminPage className={importStyles.root}>
      <section className={importStyles.hero}>
        <span className={importStyles.eyebrow}>{t('eyebrow')}</span>
        <h1>{t('title')}</h1>
        <p>{t('description')}</p>
      </section>

      <section className={importStyles.steps} aria-label={t('title')}>
        <Steps
          current={currentStep}
          responsive
          items={[
            { title: t('steps.package'), icon: <Archive size={16} /> },
            { title: t('steps.target'), icon: <FolderTree size={16} /> },
            { title: t('steps.commit'), icon: <Import size={16} /> },
          ]}
        />
      </section>

      <section className={importStyles.panel}>
        <div className={importStyles['panel-header']}>
          <div>
            <h2>{t('steps.package')}</h2>
            <p>{t('package.hint')}</p>
          </div>
          {file ? <Tag color="orange">{formatAdminBytes(locale, file.size)}</Tag> : null}
        </div>
        <Upload.Dragger
          className={importStyles.dropzone}
          accept=".zip,application/zip"
          maxCount={1}
          showUploadList={false}
          beforeUpload={(nextFile) => {
            chooseFile(nextFile)
            return Upload.LIST_IGNORE
          }}
        >
          <p><span className={importStyles['drop-icon']}><Archive size={24} /></span></p>
          <p className="ant-upload-text">{file ? file.name : t('package.empty')}</p>
          <p className="ant-upload-hint">{file ? t('package.replace') : t('package.emptyHint')}</p>
        </Upload.Dragger>
        <Space style={{ marginTop: 14 }}>
          <Button type="primary" icon={<ShieldCheck size={15} />} loading={inspecting} disabled={!file} onClick={() => void inspect()}>
            {t('actions.inspect')}
          </Button>
        </Space>

        {preview ? <PackagePreviewCard preview={preview} /> : null}
      </section>

      {preview ? (
        <section className={importStyles.panel}>
          <div className={importStyles['panel-header']}>
            <div>
              <h2>{t('steps.target')}</h2>
              <p>{preview.kind === 'project' ? t('target.versionHint') : t('target.articleHint')}</p>
            </div>
            <Tag color={preview.kind === 'project' ? 'blue' : 'gold'}>
              {preview.kind === 'project' ? t('preview.kindProject') : t('preview.kindArticle')}
            </Tag>
          </div>
          <Alert showIcon type="info" message={t('messages.projectMismatch')} style={{ marginBottom: 18 }} />
          <Form layout="vertical" component={false}>
            <div className={importStyles['target-grid']}>
              <Form.Item label={t('target.project')} required>
                <Select
                  allowClear
                  loading={projectsQuery.isLoading}
                  value={projectId}
                  placeholder={t('target.projectPlaceholder')}
                  options={(projectsQuery.data?.list || []).filter((project) => !project.isDeleted).map((project) => ({
                    label: project.projectName,
                    value: project.id,
                  }))}
                  onChange={chooseProject}
                />
              </Form.Item>
              {preview.kind === 'project' ? (
                <Form.Item label={t('target.version')} required extra={t('target.versionHint')}>
                  <input
                    className="ant-input"
                    value={version}
                    maxLength={64}
                    placeholder={t('target.versionPlaceholder')}
                    onChange={(event) => setVersion(event.target.value)}
                  />
                </Form.Item>
              ) : (
                <Form.Item label={t('target.existingVersion')} required extra={draftVersions.length ? t('target.articleHint') : t('target.noDraft')}>
                  <Select
                    allowClear
                    loading={versionsQuery.isLoading}
                    value={projectVersionId}
                    placeholder={t('target.existingVersionPlaceholder')}
                    options={draftVersions.map((item) => ({ label: item.version, value: item.id }))}
                    onChange={setProjectVersionId}
                  />
                </Form.Item>
              )}
            </div>
          </Form>
        </section>
      ) : null}

      {preview ? (
        <AdminPageActions className={importStyles.footer}>
          <Button onClick={() => router.push('/admin/mm/projects')}>{t('actions.backProjects')}</Button>
          <Button
            type="primary"
            icon={<Import size={15} />}
            loading={importing}
            disabled={!targetReady || Boolean(result)}
            onClick={() => void importPackage()}
          >
            {preview.kind === 'project' ? t('actions.importProject') : t('actions.importArticle')}
          </Button>
        </AdminPageActions>
      ) : null}

      {result ? (
        <Alert
          showIcon
          type="success"
          icon={<BookOpenText size={17} />}
          message={t('messages.importSuccess')}
          description={`${result.version} · ${t('preview.articles', { count: result.articleCount })}`}
          action={<Button type="primary" size="small" icon={<FileText size={14} />} onClick={openWorkspace}>{t('actions.openWorkspace')}</Button>}
        />
      ) : null}
    </AdminPage>
  )
}

function PackagePreviewCard({ preview }: { preview: PackagePreview }) {
  const t = useTranslations('AdminMM.knowledgeImport')
  const locale = useLocale()
  const referenceCount = preview.categories
    .flatMap((category) => category.articles)
    .reduce((count, article) => count + article.sourceReferenceCount, 0)

  return (
    <section className={importStyles.preview} aria-label={preview.title}>
      <div className={importStyles['preview-top']}>
        <div className={importStyles['preview-title']}>
          <span className={importStyles['drop-icon']}><BookOpenText size={18} /></span>
          <div>
            <strong>{preview.title}</strong>
            <span>{preview.projectName} · {t('preview.createdAt', { date: formatAdminDate(locale, preview.createdAt) })}</span>
          </div>
        </div>
        <Tag color={preview.kind === 'project' ? 'blue' : 'gold'}>
          {preview.kind === 'project' ? t('preview.kindProject') : t('preview.kindArticle')}
        </Tag>
      </div>
      <Descriptions size="small" column={{ xs: 1, sm: 3 }}>
        <Descriptions.Item label={t('preview.articles')}>{preview.articleCount}</Descriptions.Item>
        <Descriptions.Item label={t('preview.references')}>{referenceCount}</Descriptions.Item>
        <Descriptions.Item label={t('preview.packageHash')}><code>{preview.archiveHash.slice(0, 12)}…{preview.archiveHash.slice(-8)}</code></Descriptions.Item>
      </Descriptions>
      <div className={importStyles.catalog}>
        {preview.categories.map((category) => (
          <div className={importStyles.category} key={category.id}>
            <strong>{category.title}</strong>
            {category.articles.map((article) => (
                <div className={importStyles['article-line']} key={article.id}>
                <FileText size={13} />
                <span>{article.title}</span>
                <Tag>{article.articleType}</Tag>
                <span>{t('preview.references', { count: article.sourceReferenceCount })}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <code className={importStyles['package-hash']}>{preview.archiveHash}</code>
    </section>
  )
}
