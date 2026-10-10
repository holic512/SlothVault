'use client'

/**
 * @file project-credential-menu.tsx
 * @project SlothVault
 * @module Project Publication Credential Navigation
 * @description Provides two version-bound navigation actions and an on-demand publication status drawer.
 * @logic Read request-local permissions and stored evidence only when opened, keep unavailable states distinct from failed requests, and remount on version changes to prevent stale downloads.
 * @dependencies React Query, Ant Design, project credential APIs
 * @index_tags project-version,evidence,navigation,drawer,permissions
 * @author holic512
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Descriptions, Drawer, Dropdown, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import { BadgeCheck, ChevronDown, Download, ExternalLink, Fingerprint, RefreshCw } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api-client'
import type { ReleaseManifest } from '@/server/services/release-manifest'
import type { AccessReason } from '@/lib/content-access'
import styles from '@/styles/modules/project-credential.module.css'

type CredentialSummary = {
  releaseId: string; releaseHash: string; manifest: ReleaseManifest; publishedAt: string;
  canDownload: boolean; downloadReason: AccessReason;
  networks: Array<{ network: 'mainnet' | 'devnet'; status: number | null; transactionSignature: string | null; signerAddress: string | null; blockTime: string | null }>
}

export function ProjectCredentialMenu({ projectId, versionId, preview = false, mobile = false, onView }: {
  projectId: string; versionId: string; preview?: boolean; mobile?: boolean; onView?: () => void | Promise<void>
}) {
  const t = useTranslations('ProjectCredential')
  const locale = useLocale()
  const [requested, setRequested] = useState(false)
  const [open, setOpen] = useState(false)
  const endpoint = preview ? `/api/admin/mm/projectVersion/${versionId}` : `/api/project/${projectId}/v/${versionId}`
  const query = useQuery({
    queryKey: ['project-credential', projectId, versionId, preview],
    queryFn: ({ signal }) => apiFetch<CredentialSummary>(`${endpoint}/evidence`, { signal, cache: 'no-store' }),
    enabled: requested, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false, retry: false,
  })
  const data = query.isError ? undefined : query.data
  const downloadReason = query.isFetching ? t('permissionLoading') : !data ? t(query.isError ? 'loadFailed' : 'permissionLoading') : data.canDownload ? '' : t(data.downloadReason === 'DOWNLOAD_DISABLED' ? 'downloadDisabled' : data.downloadReason === 'LOGIN_REQUIRED' ? 'loginRequired' : 'membershipRequired')
  const date = (value: string) => new Date(value).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
  const statusKey = (status: number | null) => status === null ? 'notSubmitted' : status === 2 ? 'finalized' : status === 1 ? 'confirming' : status === 0 ? 'awaitingSignature' : 'failed'

  return <>
    <Dropdown trigger={['click']} onOpenChange={(visible) => {
      if (visible) { setRequested(true); if (requested) void query.refetch() }
    }} menu={{ items: [
      { key: 'view', icon: <Fingerprint size={15} />, label: t('view'), onClick: async () => { setRequested(true); await onView?.(); setOpen(true) } },
      { key: 'download', icon: <Download size={15} />, disabled: !data?.canDownload || query.isFetching,
        label: <Tooltip title={downloadReason}><span>{data?.canDownload && !query.isFetching ? <a href={`${endpoint}/manifest`} download>{t('download')}</a> : t('download')}</span></Tooltip> },
    ] }}>
      <Button type="text" className={`${styles.trigger} ${mobile ? '' : 'project-credential-trigger'}`} aria-label={t('menu')} title={t('menu')}>
        <Fingerprint size={17} /><ChevronDown size={12} />
      </Button>
    </Dropdown>
    <Drawer rootClassName={styles.drawer} title={t('title')} placement="right" size={540} open={open} onClose={() => setOpen(false)} extra={<Button type="text" aria-label={t('refresh')} icon={<RefreshCw size={16} />} loading={query.isFetching} onClick={() => void query.refetch()} />}>
      {query.isPending ? <div className={styles.loading}><Spin /></div> : query.isError ? <Alert showIcon type="error" title={t('loadFailed')} description={query.error.message} action={<Button onClick={() => void query.refetch()}>{t('retry')}</Button>} /> : data ? <>
        <p className={styles.description}>{t('description')}</p>
        <Descriptions column={1} size="small" items={[
          { key: 'project', label: t('projectName'), children: data.manifest.projectName },
          { key: 'version', label: t('version'), children: data.manifest.version },
          { key: 'published', label: t('publishedAt'), children: date(data.publishedAt) },
          { key: 'content', label: t('contentHash'), children: <Typography.Text code copyable>{data.manifest.contentHash}</Typography.Text> },
          { key: 'credential', label: t('releaseHash'), children: <Typography.Text code copyable>{data.releaseHash}</Typography.Text> },
        ]} />
        <div className={styles.networks}>{data.networks.map(network => <section className={styles.network} key={network.network}>
          <div className={styles['network-heading']}><strong>{network.network === 'mainnet' ? 'Solana Mainnet' : 'Solana Devnet'}</strong><Tag color={network.status === 2 ? 'success' : network.status === -1 ? 'error' : network.status === 1 ? 'processing' : 'default'}>{t(`status.${statusKey(network.status)}`)}</Tag></div>
          {network.network === 'devnet' ? <p className={styles['network-note']}>{t('devnetNote')}</p> : null}
          {network.signerAddress ? <p><span>{t('wallet')}</span><Typography.Text code copyable>{network.signerAddress}</Typography.Text></p> : null}
          {network.transactionSignature ? <>
            <p><span>{t('transaction')}</span><Typography.Text code copyable>{network.transactionSignature}</Typography.Text></p>
            {network.blockTime ? <p><span>{t('blockTime')}</span>{date(network.blockTime)}</p> : null}
            <Space wrap><Button size="small" href={`/evidence/${network.transactionSignature}`} target="_blank" rel="noreferrer" icon={<BadgeCheck size={14} />}>{t('receipt')}</Button><Button size="small" href={`https://explorer.solana.com/tx/${encodeURIComponent(network.transactionSignature)}${network.network === 'devnet' ? '?cluster=devnet' : ''}`} target="_blank" rel="noreferrer" icon={<ExternalLink size={14} />}>Explorer</Button></Space>
          </> : <p className={styles['network-note']}>{t('noTransaction')}</p>}
        </section>)}</div>
      </> : null}
    </Drawer>
  </>
}
