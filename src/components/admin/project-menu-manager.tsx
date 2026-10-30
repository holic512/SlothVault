'use client'

/**
 * @file project-menu-manager.tsx
 * @project SlothVault
 * @module Project Menu Administration
 * @description Edits two-level project navigation with local icon choices and a responsive, scrollable menu list.
 * @logic Prepend fixed destinations, manage custom menu CRUD and visibility, and preview automatic or explicit icons before saving.
 * @dependencies Ant Design, React Query, next-intl, api-client, project-navigation, project-menu-icons
 * @index_tags admin,project-menu,navigation,icons,tree,crud
 * @author holic512
 */
import { useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Collapse, Form, Input, InputNumber, Modal, Select, Switch, Table, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ArrowUpRight, LockKeyhole, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { ProjectMenuIcon } from '@/components/project/project-menu-icon'
import { formatAdminError } from '@/lib/admin-localization'
import { apiFetch } from '@/lib/api-client'
import { projectMenuIconKeys } from '@/lib/project-menu-icons'
import { buildProjectMenuRows, type CustomProjectMenu, type ProjectMenuRow } from '@/lib/project-navigation'
import styles from '@/styles/modules/project-menu-manager.module.css'

export type MenuProject = { publicId?: string; id: string; projectName: string }

type MenuDto = CustomProjectMenu
type MenuForm = {
  parentId?: string | null
  label: string
  icon: string
  url?: string
  isExternal: boolean
  weight: number
  status: number
}

export function ProjectMenuManager({ project, onClose }: { project: MenuProject | null; onClose: () => void }) {
  const t = useTranslations('AdminMM.projectMenu')
  const navigationT = useTranslations('ProjectNavigation')
  const errorT = useTranslations('AdminMM.errors')
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const [editing, setEditing] = useState<MenuDto | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [collapsedRows, setCollapsedRows] = useState<string[]>([])
  const [form] = Form.useForm<MenuForm>()
  const selectedIcon = Form.useWatch('icon', form)
  const selectedUrl = Form.useWatch('url', form)
  const selectedLabel = Form.useWatch('label', form)
  const selectedParentId = Form.useWatch('parentId', form)

  const query = useQuery({
    queryKey: ['admin-project-menus', project?.id],
    enabled: Boolean(project),
    queryFn: () => apiFetch<MenuDto[]>(`/api/admin/mm/menu?projectId=${project!.id}&tree=1`),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-project-menus', project?.id] })
  const roots = (query.data || []).filter((menu) => !menu.isDeleted && menu.parentId === null)
  const reportError = (error: unknown) => { message.error(formatAdminError(error, errorT)) }
  const save = useMutation({
    mutationFn: (values: MenuForm) => apiFetch<MenuDto>(editing ? `/api/admin/mm/menu/${editing.id}` : '/api/admin/mm/menu', {
      method: editing ? 'PUT' : 'POST',
      body: JSON.stringify({
        ...values,
        icon: values.icon === 'auto' ? null : values.icon,
        parentId: values.parentId || null,
        url: values.url?.trim() || null,
        ...(editing ? {} : { projectId: project!.id }),
      }),
    }),
    onSuccess: async () => {
      message.success(t('messages.saved'))
      setFormOpen(false)
      setEditing(null)
      form.resetFields()
      await refresh()
    },
    onError: reportError,
  })
  const visibility = useMutation({
    mutationFn: ({ id, status }: { id: string; status: number }) => apiFetch(`/api/admin/mm/menu/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }),
    onSuccess: refresh,
    onError: reportError,
  })
  const openForm = (menu?: MenuDto, parentId: string | null = null) => {
    setEditing(menu || null)
    form.setFieldsValue(menu ? {
      parentId: menu.parentId, label: menu.label, icon: menu.icon || 'auto', url: menu.url || '',
      isExternal: menu.isExternal, weight: menu.weight, status: menu.status,
    } : { parentId, label: '', icon: 'auto', url: '', isExternal: false, weight: 0, status: 1 })
    setFormOpen(true)
  }
  const remove = (menu: MenuDto) => {
    modal.confirm({
      title: t('operations.delete'), content: t('messages.deleteConfirm', { name: menu.label }),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await apiFetch(`/api/admin/mm/menu/${menu.id}`, { method: 'DELETE' })
          message.success(t('messages.deleted'))
          await refresh()
        } catch (error) { reportError(error); throw error }
      },
    })
  }
  const columns: ColumnsType<ProjectMenuRow> = [
    {
      title: t('table.label'), dataIndex: 'label', width: 280,
      render: (_value, row) => <div className={styles['menu-label']}>
        <span className={styles['icon-slot']}><ProjectMenuIcon {...row} size={18} /></span>
        <span className={styles['label-text']} title={row.label}>{row.label}</span>
        {row.kind === 'builtin' ? <Tooltip title={t('operations.fixed')}><LockKeyhole size={13} className={styles.muted} aria-label={t('source.builtin')} /></Tooltip> : null}
      </div>,
    },
    {
      title: t('table.url'), dataIndex: 'url',
      render: (value, row) => <div className={styles.destination}>
        <span title={value || undefined}>{value || (row.kind === 'custom' && row.children?.length ? t('type.group') : '—')}</span>
        {row.isExternal ? <ArrowUpRight size={15} aria-label={t('type.external')} /> : null}
      </div>,
    },
    {
      title: t('table.status'), width: 100,
      render: (_value, row) => row.kind === 'builtin' ? <Typography.Text type="secondary">{t('status.always')}</Typography.Text> : (
        <Switch checked={row.status === 1} checkedChildren={t('status.enabled')} unCheckedChildren={t('status.disabled')}
          aria-label={t('operations.visibility', { name: row.label })}
          disabled={visibility.isPending} loading={visibility.isPending && visibility.variables?.id === row.id}
          onChange={(checked) => visibility.mutate({ id: row.id, status: checked ? 1 : 0 })} />
      ),
    },
    {
      title: t('table.operations'), width: 188,
      render: (_value, row) => row.kind === 'builtin' ? null : <div className={styles.actions}>
        {row.parentId === null ? <Tooltip title={t('operations.child')}><Button type="text" aria-label={t('operations.childOf', { name: row.label })} icon={<Plus size={17} />} onClick={() => openForm(undefined, row.id)} /></Tooltip> : null}
        <Button type="text" icon={<Pencil size={16} />} onClick={() => openForm(row.menu)} aria-label={t('operations.editNamed', { name: row.label })}>{t('operations.edit')}</Button>
        <Tooltip title={t('operations.delete')}><Button type="text" danger aria-label={t('operations.deleteNamed', { name: row.label })} icon={<Trash2 size={17} />} onClick={() => remove(row.menu)} /></Tooltip>
      </div>,
    },
  ]
  const automaticIcon = { url: selectedUrl, children: editing?.children }
  const iconOptions = [
    { value: 'auto', label: <span className={styles['icon-option']}><ProjectMenuIcon {...automaticIcon} />{t('icons.auto')}</span>, searchLabel: t('icons.auto') },
    ...projectMenuIconKeys.map((key) => ({
      value: key,
      label: <span className={styles['icon-option']}>{key === 'none' ? <span className={styles['icon-slot']} /> : <ProjectMenuIcon icon={key} />}{t(`icons.${key}`)}</span>,
      searchLabel: `${t(`icons.${key}`)} ${key}`,
    })),
  ]

  return <Modal open={Boolean(project)} width={1140} className={styles.manager}
    title={t('title', { name: project?.projectName || '' })} footer={null}
    onCancel={() => { setFormOpen(false); onClose() }}>
    <div className={styles.content}>
      {query.isError ? <Alert showIcon type="error" title={t('messages.loadFailed')}
        description={formatAdminError(query.error, errorT)}
        action={<Button loading={query.isFetching} onClick={() => { void query.refetch() }}>{t('operations.retry')}</Button>} /> : null}
      <div className={styles.toolbar}>
        <Typography.Text type="secondary">{t('desc')}</Typography.Text>
        <Button type="primary" icon={<Plus size={17} />} onClick={() => openForm()}>{t('newRoot')}</Button>
      </div>
      <div className={styles['table-scroll']} role="region" aria-label={t('table.navigation')} tabIndex={0}>
        <Table rowKey="rowKey" loading={query.isLoading}
          dataSource={project ? buildProjectMenuRows(project.publicId || project.id, query.data || [], navigationT) : []}
          columns={columns} pagination={false} tableLayout="fixed"
          expandable={{
            expandedRowKeys: roots.map((root) => `custom:${root.id}`).filter((key) => !collapsedRows.includes(key)),
            onExpand: (expanded, row) => setCollapsedRows((keys) => expanded ? keys.filter((key) => key !== row.rowKey) : [...keys, row.rowKey]),
            indentSize: 22,
          }} />
      </div>
    </div>
    <Modal open={formOpen} width={640} className={styles.editor}
      title={editing ? t('dialog.editTitle') : selectedParentId ? t('dialog.createChildTitle', { name: roots.find((root) => root.id === selectedParentId)?.label || '' }) : t('dialog.createTitle')}
      okText={t('dialog.save')} cancelText={t('dialog.cancel')} confirmLoading={save.isPending}
      onCancel={() => setFormOpen(false)} onOk={() => form.submit()} forceRender>
      <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)} requiredMark={false}>
        <Form.Item name="label" label={t('dialog.label')} rules={[{ required: true, whitespace: true, message: t('messages.labelRequired') }]}>
          <Input maxLength={64} placeholder={t('dialog.labelPlaceholder')} autoComplete="off" />
        </Form.Item>
        <Form.Item name="url" label={t('dialog.url')} dependencies={['isExternal']}
          rules={[{ validator: async (_rule, raw: string | undefined) => {
            const value = raw?.trim()
            if (!value) return
            if (form.getFieldValue('isExternal')) {
              try { const url = new URL(value); if (url.protocol === 'https:' || url.protocol === 'http:') return } catch { /* Show the actionable form error below. */ }
              throw new Error(t('messages.externalUrl'))
            }
            if (!value.startsWith('/') || value.startsWith('//')) throw new Error(t('messages.internalUrl'))
          } }]}>
          <Input maxLength={2048} placeholder={t('dialog.urlPlaceholder')} autoComplete="off"
            onChange={(event) => {
              const url = event.target.value.trim()
              if (/^https?:\/\//i.test(url)) form.setFieldValue('isExternal', true)
              else if (url.startsWith('/') && !url.startsWith('//')) form.setFieldValue('isExternal', false)
            }} />
        </Form.Item>
        <div className={styles['icon-field']}>
          <Form.Item name="icon" label={t('dialog.icon')}>
            <Select showSearch={{ filterOption: (input, option) => Boolean(option?.searchLabel.toLowerCase().includes(input.toLowerCase())) }} options={iconOptions} />
          </Form.Item>
          <div className={styles.preview} aria-label={t('dialog.preview')}>
            <ProjectMenuIcon {...automaticIcon} icon={selectedIcon === 'auto' ? null : selectedIcon} />
            <span>{selectedLabel?.trim() || t('dialog.previewName')}</span>
          </div>
        </div>
        <div className={styles['switch-field']}>
          <label htmlFor="menu-external">{t('dialog.external')}</label>
          <Form.Item name="isExternal" valuePropName="checked" noStyle><Switch id="menu-external" /></Form.Item>
        </div>
        <Collapse ghost items={[{ key: 'advanced', forceRender: true, label: t('dialog.advanced'), children: <div className={styles['advanced-grid']}>
          <Form.Item name="parentId" label={t('dialog.parent')}>
            <Select allowClear placeholder={t('dialog.root')} disabled={Boolean(editing?.children?.length)} options={roots.filter((root) => root.id !== editing?.id).map((root) => ({ label: root.label, value: root.id }))} />
          </Form.Item>
          <Form.Item name="weight" label={t('dialog.weight')}><InputNumber className="full-width" /></Form.Item>
          <Form.Item name="status" label={t('dialog.status')}><Select options={[{ label: t('status.enabled'), value: 1 }, { label: t('status.disabled'), value: 0 }]} /></Form.Item>
        </div> }]} />
      </Form>
    </Modal>
  </Modal>
}
