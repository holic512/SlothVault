'use client'

/**
 * @file files-manager.tsx
 * @project SlothVault
 * @module File Administration
 * @description Provides an Ant Design file upload, preview, filtering, and deletion workflow.
 * @logic Query server-owned file metadata, stage bounded multipart uploads, and expose soft, batch, and explicit hard-delete actions.
 * @dependencies Ant Design, React Query, next-intl, api-client
 * @index_tags admin,files,upload,preview,delete
 * @author holic512
 */
import { useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App,
  Button,
  Image,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Upload,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { UploadFile } from 'antd/es/upload/interface'
import { FileArchive, FileImage, RefreshCw, Trash2, UploadCloud } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { AdminPage, AdminPageActions } from '@/components/admin/admin-page'
import { apiFetch } from '@/lib/api-client'

type FileDto = {
  id: string
  originalName: string
  fileName: string
  filePath: string
  fileSize: string
  businessType: string
  status: number
  createTime: string
  url: string
}
type FileListData = { list: FileDto[]; page: number; pageSize: number; total: number }

const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])

function isImage(file: FileDto) {
  const extension = file.originalName.split('.').pop()?.toLocaleLowerCase() || ''
  return imageExtensions.has(extension)
}

function formatFileSize(raw: string) {
  const bytes = Number(raw)
  if (!Number.isFinite(bytes)) return raw
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function FilesManager() {
  const t = useTranslations('AdminMM.files')
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [businessType, setBusinessType] = useState<string>()
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [selectedIds, setSelectedIds] = useState<React.Key[]>([])
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadBusinessType, setUploadBusinessType] = useState('NoteAttachment')
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([])
  const [previewFile, setPreviewFile] = useState<FileDto | null>(null)

  const businessTypeOptions = [
    'SystemLogo',
    'SystemFavicon',
    'ProjectAvatar',
    'UserAvatar',
    'NoteAttachment',
    'HomeworkFile',
    'TempFile',
    'Other',
  ].map((value) => ({ label: t(`businessType.${value}`), value }))

  const listQuery = useQuery({
    queryKey: ['admin-files', page, pageSize, keyword, businessType, includeDeleted],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (keyword) params.set('keyword', keyword)
      if (businessType) params.set('businessType', businessType)
      if (includeDeleted) params.set('includeDeleted', '1')
      return apiFetch<FileListData>(`/api/admin/mm/file?${params}`)
    },
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-files'] })

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const rawFiles = uploadFiles.flatMap((file) =>
        file.originFileObj ? [file.originFileObj] : [],
      )
      if (!rawFiles.length) throw new Error(t('messages.selectFileFirst'))
      const formData = new FormData()
      rawFiles.forEach((file) => formData.append('file', file))
      return apiFetch<FileDto[]>(
        `/api/admin/mm/file?businessType=${encodeURIComponent(uploadBusinessType)}`,
        { method: 'POST', body: formData },
      )
    },
    onSuccess: async () => {
      message.success(t('messages.uploadSuccess'))
      setUploadOpen(false)
      setUploadFiles([])
      await refresh()
    },
    onError: (error) => message.error(error.message),
  })

  const batchDelete = () => {
    if (!selectedIds.length) return message.warning(t('messages.selectFirst'))
    modal.confirm({
      title: t('messages.deleteConfirmTitle'),
      content: t('messages.batchDeleteConfirm', { count: selectedIds.length }),
      okText: t('messages.deleteButton'),
      okButtonProps: { danger: true },
      cancelText: t('messages.cancelButton'),
      onOk: async () => {
        await apiFetch('/api/admin/mm/file/batch', {
          method: 'POST',
          body: JSON.stringify({ action: 'delete', ids: selectedIds.map(String) }),
        })
        setSelectedIds([])
        message.success(t('messages.batchDeleteSuccess'))
        await refresh()
      },
    })
  }

  const remove = (file: FileDto, hard = false) => {
    modal.confirm({
      title: hard ? t('messages.hardDeleteConfirmTitle') : t('messages.deleteConfirmTitle'),
      content: hard
        ? t('messages.hardDeleteConfirm', { name: file.originalName })
        : t('messages.deleteConfirm', { name: file.originalName }),
      okText: hard ? t('messages.hardDeleteButton') : t('messages.deleteButton'),
      okButtonProps: { danger: true },
      cancelText: t('messages.cancelButton'),
      onOk: async () => {
        await apiFetch(`/api/admin/mm/file/${file.id}${hard ? '?hard=1' : ''}`, {
          method: 'DELETE',
        })
        message.success(hard ? t('messages.hardDeleted') : t('messages.deleted'))
        await refresh()
      },
    })
  }

  const columns: ColumnsType<FileDto> = [
    {
      title: t('table.preview'),
      width: 82,
      render: (_value, row) =>
        isImage(row) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="file-preview-thumb" src={row.url} alt="" />
        ) : (
          <span className="file-preview-fallback"><FileArchive size={20} /></span>
        ),
    },
    { title: t('table.originalName'), dataIndex: 'originalName', minWidth: 230, ellipsis: true },
    {
      title: t('table.fileSize'),
      dataIndex: 'fileSize',
      width: 105,
      render: (value) => formatFileSize(value),
    },
    {
      title: t('table.businessType'),
      dataIndex: 'businessType',
      width: 145,
      render: (value) => (
        <Tag color={value === 'ProjectAvatar' ? 'purple' : value === 'NoteAttachment' ? 'blue' : undefined}>
          {businessTypeOptions.find((option) => option.value === value)?.label || value}
        </Tag>
      ),
    },
    {
      title: t('table.status'),
      dataIndex: 'status',
      width: 92,
      render: (value) =>
        value === 1 ? (
          <Tag color="success">{t('statusTag.normal')}</Tag>
        ) : (
          <Tag>{t('statusTag.deleted')}</Tag>
        ),
    },
    {
      title: t('table.uploadTime'),
      dataIndex: 'createTime',
      width: 170,
      render: (value) => new Date(value).toLocaleString(),
    },
    {
      title: t('table.operations'),
      fixed: 'right',
      width: 220,
      render: (_value, row) => (
        <Space size={2}>
          <Button
            type="link"
            onClick={() => {
              if (isImage(row)) setPreviewFile(row)
              else window.open(row.url, '_blank', 'noopener,noreferrer')
            }}
          >
            {t('operations.preview')}
          </Button>
          {row.status === 1 ? (
            <Button type="link" danger icon={<Trash2 size={13} />} onClick={() => remove(row)}>
              {t('operations.delete')}
            </Button>
          ) : (
            <Button type="link" danger onClick={() => remove(row, true)}>
              {t('operations.hardDelete')}
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
          <Button icon={<RefreshCw size={15} />} onClick={() => void refresh()}>
            {t('actions.search')}
          </Button>
          <Button type="primary" icon={<UploadCloud size={15} />} onClick={() => setUploadOpen(true)}>
            {t('actions.upload')}
          </Button>
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
            value={businessType}
            placeholder={t('filters.businessType')}
            options={businessTypeOptions}
            onChange={(value) => {
              setBusinessType(value)
              setPage(1)
            }}
          />
          <label className="admin-switch-label">
            <Switch
              checked={includeDeleted}
              onChange={(value) => {
                setIncludeDeleted(value)
                setPage(1)
              }}
            />
            {t('filters.includeDeleted')}
          </label>
        </div>
        <Button danger disabled={!selectedIds.length} onClick={batchDelete}>
          {t('actions.batchDelete')} {selectedIds.length ? `(${selectedIds.length})` : ''}
        </Button>
      </div>

      <div className="admin-table-card">
        <Table
          rowKey="id"
          scroll={{ x: 1050 }}
          loading={listQuery.isLoading}
          dataSource={listQuery.data?.list || []}
          columns={columns}
          rowSelection={{ selectedRowKeys: selectedIds, onChange: setSelectedIds }}
          pagination={{
            current: page,
            pageSize,
            total: listQuery.data?.total || 0,
            showSizeChanger: true,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage)
              setPageSize(nextPageSize)
            },
          }}
        />
      </div>

      <Modal
        open={uploadOpen}
        title={t('dialog.uploadTitle')}
        okText={t('dialog.upload')}
        cancelText={t('dialog.cancel')}
        confirmLoading={uploadMutation.isPending}
        onCancel={() => setUploadOpen(false)}
        onOk={() => uploadMutation.mutate()}
      >
        <Space orientation="vertical" size={14} className="full-width">
          <Select
            className="full-width"
            value={uploadBusinessType}
            options={businessTypeOptions}
            onChange={setUploadBusinessType}
          />
          <Upload.Dragger
            multiple={uploadBusinessType !== 'SystemLogo' && uploadBusinessType !== 'SystemFavicon'}
            maxCount={uploadBusinessType === 'SystemLogo' || uploadBusinessType === 'SystemFavicon' ? 1 : 10}
            beforeUpload={() => false}
            fileList={uploadFiles}
            onChange={({ fileList }) => setUploadFiles(fileList)}
          >
            <p className="ant-upload-drag-icon"><FileImage size={34} /></p>
            <p className="ant-upload-text">{t('dialog.uploadHint')}</p>
            <p className="ant-upload-hint">{t('dialog.uploadTip')}</p>
          </Upload.Dragger>
        </Space>
      </Modal>

      <Modal
        open={Boolean(previewFile)}
        title={t('dialog.previewTitle')}
        width="min(920px, 92vw)"
        footer={null}
        onCancel={() => setPreviewFile(null)}
      >
        {previewFile ? <Image className="file-preview-image" src={previewFile.url} alt={previewFile.originalName} /> : null}
      </Modal>
    </AdminPage>
  )
}
