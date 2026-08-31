'use client'

/**
 * @file dashboard-view.tsx
 * @project SlothVault
 * @module Admin Operations Dashboard
 * @description Renders the responsive operations command center with live metrics, accessible SVG trends, health, distribution, attention, and activity surfaces.
 * @logic Fetch one selectable dashboard window, format data in the active locale, expose metric and activity links to existing workflows, and retain readable zero, loading, and failure states across themes.
 * @dependencies Ant Design, React Query, next-intl, Lucide, admin dashboard API, admin localization utilities
 * @index_tags admin,dashboard,operations,analytics,trends,i18n,responsive
 * @author holic512
 */
import { useMemo, useState } from 'react'

import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Empty, Progress, Segmented, Skeleton, Tag, Typography } from 'antd'
import type { LucideIcon } from 'lucide-react'
import {
  ArchiveRestore,
  BadgeCheck,
  BookOpenText,
  Boxes,
  ChartNoAxesCombined,
  CircleAlert,
  Clock3,
  Coins,
  FileStack,
  FolderTree,
  FolderUp,
  Newspaper,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Users,
  UsersRound,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'

import { AdminPage } from '@/components/admin/admin-page'
import { formatAdminBytes, formatAdminDate, formatAdminNumber } from '@/lib/admin-localization'
import { apiFetch } from '@/lib/api-client'

type DashboardRange = 7 | 30 | 90
type TrendKey = 'users' | 'projects' | 'articles' | 'notes'

type DashboardData = {
  range: { days: DashboardRange; start: string; end: string; generatedAt: string }
  overview: {
    users: { total: number; activeSessions: number; totalPoints: number }
    giftCards: { total: number; redeemed: number }
    articles: { total: number; published: number }
    projects: { total: number; active: number }
    versions: { total: number; active: number }
    categories: { total: number; active: number }
    notes: { total: number; active: number }
    files: { total: number; totalSizeBytes: string; totalSizeMB: string; byType: Array<{ type: string; count: number; sizeBytes: string }> }
    blockchain: { evidence: { total: number; finalized: number; failed: number; pending: number } }
  }
  periodTotals: Record<TrendKey, number>
  trend: Array<{ date: string } & Record<TrendKey, number>>
  health: Record<'projectUtilization' | 'articlePublicationRate' | 'noteUtilization' | 'categoryUtilization' | 'evidenceFinalizationRate', number>
  recentActivity: {
    feed: Array<{
      id: string
      type: 'project' | 'article' | 'note' | 'session'
      title: string
      detail?: string
      timestamp: string
      href: string
      status?: 'active' | 'expired' | 'revoked'
    }>
  }
}

const TREND_KEYS = ['users', 'projects', 'articles', 'notes'] as const

const TREND_STYLE: Record<TrendKey, { color: string; className: string }> = {
  users: { color: 'var(--sv-dashboard-users)', className: 'is-users' },
  projects: { color: 'var(--sv-dashboard-projects)', className: 'is-projects' },
  articles: { color: 'var(--sv-dashboard-content)', className: 'is-content' },
  notes: { color: 'var(--sv-dashboard-notes)', className: 'is-notes' },
}

const ACTIVITY_ICON: Record<DashboardData['recentActivity']['feed'][number]['type'], LucideIcon> = {
  project: Boxes,
  article: Newspaper,
  note: BookOpenText,
  session: UsersRound,
}

function DashboardTrendChart({
  trend,
  labels,
  locale,
  ariaLabel,
  emptyLabel,
}: {
  trend: DashboardData['trend']
  labels: Record<TrendKey, string>
  locale: string
  ariaLabel: string
  emptyLabel: string
}) {
  const [visible, setVisible] = useState<Record<TrendKey, boolean>>({
    users: true,
    projects: true,
    articles: true,
    notes: true,
  })
  const width = 760
  const height = 264
  const left = 28
  const right = 12
  const top = 16
  const bottom = 34
  const chartWidth = width - left - right
  const chartHeight = height - top - bottom
  const visibleKeys = TREND_KEYS.filter((key) => visible[key])
  const maximum = Math.max(1, ...trend.flatMap((point) => visibleKeys.map((key) => point[key])))
  const hasData = trend.some((point) => TREND_KEYS.some((key) => point[key] > 0))
  const x = (index: number) => left + (trend.length <= 1 ? chartWidth / 2 : (index / (trend.length - 1)) * chartWidth)
  const y = (value: number) => top + chartHeight - (value / maximum) * chartHeight
  const polyline = (key: TrendKey) => trend.map((point, index) => `${x(index)},${y(point[key])}`).join(' ')
  const labelStep = Math.max(1, Math.ceil(trend.length / 6))

  return (
    <div className="dashboard-trend-chart">
      <div className="dashboard-trend-legend" aria-label={ariaLabel}>
        {TREND_KEYS.map((key) => (
          <button
            aria-pressed={visible[key]}
            className={`dashboard-trend-toggle ${TREND_STYLE[key].className} ${visible[key] ? '' : 'is-muted'}`}
            key={key}
            onClick={() => setVisible((current) => ({ ...current, [key]: !current[key] }))}
            type="button"
          >
            <span aria-hidden="true" />
            {labels[key]}
          </button>
        ))}
      </div>
      <div className="dashboard-chart-stage">
        <svg aria-label={ariaLabel} role="img" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          {[0, .25, .5, .75, 1].map((step) => {
            const position = top + chartHeight * step
            const value = Math.round(maximum * (1 - step))
            return (
              <g key={step}>
                <line className="dashboard-chart-grid" x1={left} x2={width - right} y1={position} y2={position} />
                <text className="dashboard-chart-axis" x={left - 7} y={position + 3} textAnchor="end">{value}</text>
              </g>
            )
          })}
          {trend.map((point, index) => (
            index % labelStep === 0 || index === trend.length - 1 ? (
              <text className="dashboard-chart-axis" key={point.date} x={x(index)} y={height - 10} textAnchor="middle">
                {new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${point.date}T00:00:00.000Z`))}
              </text>
            ) : null
          ))}
          {visibleKeys.map((key) => (
            <polyline className={`dashboard-chart-line ${TREND_STYLE[key].className}`} fill="none" key={key} points={polyline(key)} />
          ))}
          {visibleKeys.flatMap((key) => trend.map((point, index) => (
            <circle className={`dashboard-chart-dot ${TREND_STYLE[key].className}`} cx={x(index)} cy={y(point[key])} key={`${key}-${point.date}`} r="2.5">
              <title>{`${labels[key]} · ${point.date}: ${point[key]}`}</title>
            </circle>
          )))}
        </svg>
        {!hasData ? <div className="dashboard-chart-empty"><ChartNoAxesCombined size={20} /><span>{emptyLabel}</span></div> : null}
      </div>
    </div>
  )
}

export function DashboardView() {
  const t = useTranslations('AdminMM.dashboard')
  const locale = useLocale()
  const [range, setRange] = useState<DashboardRange>(30)
  const query = useQuery({
    queryKey: ['admin-dashboard', range],
    queryFn: () => apiFetch<DashboardData>(`/api/admin/mm/dashboard?range=${range}`),
  })
  const data = query.data

  const trendLabels = useMemo<Record<TrendKey, string>>(() => ({
    users: t('trend.users'),
    projects: t('trend.projects'),
    articles: t('trend.articles'),
    notes: t('trend.notes'),
  }), [t])

  if (query.isError) {
    return (
      <AdminPage className="admin-dashboard-page">
        <DashboardToolbar range={range} setRange={setRange} loading={query.isFetching} onRefresh={() => void query.refetch()} t={t} />
        <Alert
          type="error"
          showIcon
          message={t('messages.loadFailed')}
          description={t('messages.loadFailedDescription')}
          action={<Button onClick={() => void query.refetch()}>{t('actions.refresh')}</Button>}
        />
      </AdminPage>
    )
  }

  if (!data) {
    return (
      <AdminPage className="admin-dashboard-page">
        <DashboardToolbar range={range} setRange={setRange} loading onRefresh={() => undefined} t={t} />
        <div className="dashboard-metric-grid" aria-busy="true">
          {Array.from({ length: 8 }, (_, index) => <Card className="dashboard-metric-card" key={index}><Skeleton active paragraph={{ rows: 2 }} title={false} /></Card>)}
        </div>
        <div className="dashboard-loading-panels"><Skeleton active paragraph={{ rows: 8 }} /><Skeleton active paragraph={{ rows: 8 }} /></div>
      </AdminPage>
    )
  }

  const { overview, periodTotals } = data
  const evidence = overview.blockchain.evidence
  const metrics: Array<{
    key: string
    icon: LucideIcon
    tone: string
    title: string
    value: string
    meta: string
    href: string
  }> = [
    { key: 'users', icon: Users, tone: 'users', title: t('stats.users'), value: formatAdminNumber(locale, overview.users.total), meta: t('metrics.users', { count: formatAdminNumber(locale, periodTotals.users), days: data.range.days }), href: '/admin/mm/users' },
    { key: 'sessions', icon: ShieldCheck, tone: 'sessions', title: t('stats.activeSessions'), value: formatAdminNumber(locale, overview.users.activeSessions), meta: t('metrics.sessions'), href: '/admin/mm/users' },
    { key: 'projects', icon: Boxes, tone: 'projects', title: t('stats.projects'), value: formatAdminNumber(locale, overview.projects.total), meta: t('metrics.projects', { active: formatAdminNumber(locale, overview.projects.active), versions: formatAdminNumber(locale, overview.versions.total), count: formatAdminNumber(locale, periodTotals.projects) }), href: '/admin/mm/projects' },
    { key: 'content', icon: Newspaper, tone: 'content', title: t('stats.articles'), value: formatAdminNumber(locale, overview.articles.total), meta: t('metrics.content', { published: formatAdminNumber(locale, overview.articles.published), notes: formatAdminNumber(locale, overview.notes.total), count: formatAdminNumber(locale, periodTotals.articles) }), href: '/admin/mm/articles' },
    { key: 'categories', icon: FolderTree, tone: 'categories', title: t('stats.categories'), value: formatAdminNumber(locale, overview.categories.total), meta: t('metrics.categories', { active: formatAdminNumber(locale, overview.categories.active), notes: formatAdminNumber(locale, overview.notes.active) }), href: '/admin/mm/notes' },
    { key: 'points', icon: Coins, tone: 'points', title: t('stats.points'), value: formatAdminNumber(locale, overview.users.totalPoints), meta: t('metrics.points', { redeemed: formatAdminNumber(locale, overview.giftCards.redeemed), total: formatAdminNumber(locale, overview.giftCards.total) }), href: '/admin/mm/gift-cards' },
    { key: 'files', icon: FileStack, tone: 'files', title: t('stats.files'), value: formatAdminBytes(locale, overview.files.totalSizeBytes), meta: t('metrics.files', { count: formatAdminNumber(locale, overview.files.total) }), href: '/admin/mm/files' },
    { key: 'evidence', icon: ArchiveRestore, tone: 'evidence', title: t('stats.evidence'), value: formatAdminNumber(locale, evidence.total), meta: t('metrics.evidence', { finalized: formatAdminNumber(locale, evidence.finalized), pending: formatAdminNumber(locale, evidence.pending) }), href: '/admin/mm/evidence' },
  ]
  const healthEntries = Object.entries(data.health) as Array<[keyof DashboardData['health'], number]>
  const fileTypes = [...overview.files.byType].sort((left, right) => right.count - left.count).slice(0, 5)
  const fileMaximum = Math.max(1, ...fileTypes.map((item) => item.count))
  const attention = [
    evidence.failed > 0 ? { key: 'failed', icon: CircleAlert, tone: 'danger', title: t('attention.failedTitle', { count: formatAdminNumber(locale, evidence.failed) }), description: t('attention.failedDescription'), href: '/admin/mm/evidence' } : null,
    evidence.pending > 0 ? { key: 'pending', icon: Clock3, tone: 'warning', title: t('attention.pendingTitle', { count: formatAdminNumber(locale, evidence.pending) }), description: t('attention.pendingDescription'), href: '/admin/mm/evidence' } : null,
  ].filter(Boolean) as Array<{ key: string; icon: LucideIcon; tone: string; title: string; description: string; href: string }>

  return (
    <AdminPage className="admin-dashboard-page">
      <DashboardToolbar range={range} setRange={setRange} loading={query.isFetching} onRefresh={() => void query.refetch()} t={t} generatedAt={formatAdminDate(locale, data.range.generatedAt)} />

      <section className="dashboard-metric-grid" aria-label={t('metrics.title')}>
        {metrics.map((metric) => {
          const Icon = metric.icon
          return (
            <Link className={`dashboard-metric-card is-${metric.tone}`} href={metric.href} key={metric.key}>
              <span className="dashboard-metric-topline"><span className="dashboard-metric-icon"><Icon size={19} /></span><span className="dashboard-metric-arrow">↗</span></span>
              <span className="dashboard-metric-label">{metric.title}</span>
              <strong className="dashboard-metric-value">{metric.value}</strong>
              <span className="dashboard-metric-meta">{metric.meta}</span>
            </Link>
          )
        })}
      </section>

      <section className="dashboard-primary-grid">
        <Card className="dashboard-panel dashboard-trend-panel" title={<PanelTitle icon={ChartNoAxesCombined} title={t('trend.title')} description={t('trend.description', { days: data.range.days })} />}>
          <DashboardTrendChart ariaLabel={t('trend.accessible')} emptyLabel={t('trend.empty')} labels={trendLabels} locale={locale} trend={data.trend} />
        </Card>
        <Card className="dashboard-panel dashboard-health-panel" title={<PanelTitle icon={ServerCog} title={t('health.title')} description={t('health.description')} />}>
          <div className="dashboard-health-list">
            {healthEntries.map(([key, value]) => (
              <div className="dashboard-health-row" key={key}>
                <div><span>{t(`health.${key}`)}</span><strong>{formatAdminNumber(locale, value)}%</strong></div>
                <Progress percent={value} showInfo={false} strokeColor="var(--sv-dashboard-health)" />
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="dashboard-secondary-grid">
        <Card className="dashboard-panel" title={<PanelTitle icon={FolderUp} title={t('files.typeDistribution')} description={t('files.description', { count: formatAdminNumber(locale, overview.files.total) })} />}>
          {fileTypes.length ? (
            <div className="dashboard-distribution-list">
              {fileTypes.map((item) => (
                <div className="dashboard-distribution-row" key={item.type}>
                  <div><span>{t('files.type', { type: item.type })}</span><strong>{formatAdminNumber(locale, item.count)}</strong></div>
                  <span className="dashboard-distribution-track"><span style={{ width: `${(item.count / fileMaximum) * 100}%` }} /></span>
                  <small>{formatAdminBytes(locale, item.sizeBytes)}</small>
                </div>
              ))}
            </div>
          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('messages.noData')} />}
        </Card>
        <Card className="dashboard-panel" title={<PanelTitle icon={BadgeCheck} title={t('evidence.title')} description={t('evidence.description')} />}>
          <div className="dashboard-evidence-summary">
            {[
              { key: 'finalized', value: evidence.finalized, tone: 'success' },
              { key: 'pending', value: evidence.pending, tone: 'warning' },
              { key: 'failed', value: evidence.failed, tone: 'danger' },
            ].map((item) => (
              <Link className={`dashboard-evidence-status is-${item.tone}`} href="/admin/mm/evidence" key={item.key}>
                <span>{t(`evidence.${item.key}`)}</span><strong>{formatAdminNumber(locale, item.value)}</strong>
              </Link>
            ))}
          </div>
          <Link className="dashboard-panel-link" href="/admin/mm/evidence">{t('actions.openEvidence')} <span aria-hidden="true">→</span></Link>
        </Card>
        <Card className="dashboard-panel dashboard-attention-panel" title={<PanelTitle icon={CircleAlert} title={t('attention.title')} description={t('attention.description')} />}>
          {attention.length ? (
            <div className="dashboard-attention-list">
              {attention.map((item) => {
                const Icon = item.icon
                return <Link className={`dashboard-attention-item is-${item.tone}`} href={item.href} key={item.key}><Icon size={18} /><span><strong>{item.title}</strong><small>{item.description}</small></span><span aria-hidden="true">→</span></Link>
              })}
            </div>
          ) : <div className="dashboard-all-clear"><ShieldCheck size={22} /><span><strong>{t('attention.clearTitle')}</strong><small>{t('attention.clearDescription')}</small></span></div>}
        </Card>
      </section>

      <Card className="dashboard-panel dashboard-activity-panel" title={<PanelTitle icon={Clock3} title={t('recent.title')} description={t('recent.description')} />}>
        {data.recentActivity.feed.length ? (
          <div className="dashboard-activity-list">
            {data.recentActivity.feed.map((item) => {
              const Icon = ACTIVITY_ICON[item.type]
              return (
                <Link className="dashboard-activity-item" href={item.href} key={item.id}>
                  <span className={`dashboard-activity-icon is-${item.type}`}><Icon size={17} /></span>
                  <span className="dashboard-activity-copy"><strong>{item.title}</strong><small>{item.detail || t(`recent.types.${item.type}`)}</small></span>
                  {item.status ? <Tag className={`dashboard-activity-status is-${item.status}`}>{t(`recent.status.${item.status}`)}</Tag> : null}
                  <time dateTime={item.timestamp}>{formatAdminDate(locale, item.timestamp)}</time>
                  <span className="dashboard-activity-arrow" aria-hidden="true">→</span>
                </Link>
              )
            })}
          </div>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('messages.noData')} />}
      </Card>
    </AdminPage>
  )
}

function DashboardToolbar({
  range,
  setRange,
  loading,
  onRefresh,
  t,
  generatedAt,
}: {
  range: DashboardRange
  setRange: (value: DashboardRange) => void
  loading: boolean
  onRefresh: () => void
  t: ReturnType<typeof useTranslations<'AdminMM.dashboard'>>
  generatedAt?: string
}) {
  return (
    <header className="dashboard-toolbar">
      <div className="dashboard-toolbar-copy">
        <span className="dashboard-eyebrow">{t('eyebrow')}</span>
        <div><Typography.Title level={3}>{t('title')}</Typography.Title><Typography.Text type="secondary">{t('desc')}</Typography.Text></div>
      </div>
      <div className="dashboard-toolbar-actions">
        <Segmented<DashboardRange> aria-label={t('rangeLabel')} disabled={loading} onChange={setRange} options={[7, 30, 90].map((value) => ({ label: t('range', { days: value }), value: value as DashboardRange }))} value={range} />
        <Button icon={<RefreshCw size={15} />} loading={loading} onClick={onRefresh}>{t('actions.refresh')}</Button>
        {generatedAt ? <Typography.Text className="dashboard-generated-at" type="secondary">{t('generatedAt', { date: generatedAt })}</Typography.Text> : null}
      </div>
    </header>
  )
}

function PanelTitle({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return <span className="dashboard-panel-title"><span><Icon size={16} /></span><span><strong>{title}</strong><small>{description}</small></span></span>
}
