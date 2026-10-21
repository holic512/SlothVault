'use client'

import { PluginSlot } from '@/components/plugins/plugin-ui'

/**
 * @file dashboard-view.tsx
 * @project SlothVault
 * @module Admin Operations Dashboard
 * @description Renders a compact administration overview with grouped metrics, accessible activity trends, content readiness, evidence follow-up and recent changes.
 * @logic Preserve overview data while changing the trend window, distinguish empty rates from zero, use integer chart ticks, and expose keyboard-accessible metric and activity links across themes and screen sizes. Retain optional plugin statistics in their existing lazy dashboard slot.
 * @dependencies Ant Design, React Query, next-intl, Lucide, admin dashboard API, admin localization utilities, PluginSlot
 * @index_tags admin,dashboard,operations,analytics,trends,i18n,responsive
 * @author holic512
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Alert, Button, Card, Empty, Progress, Segmented, Skeleton, Tag } from 'antd'
import type { LucideIcon } from 'lucide-react'
import {
  ArchiveRestore,
  ArrowRight,
  ArrowUpRight,
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
  ShieldCheck,
  Users,
  UsersRound,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'

import { AdminPage } from '@/components/admin/admin-page'
import { formatAdminBytes, formatAdminDate, formatAdminNumber } from '@/lib/admin-localization'
import { apiFetch } from '@/lib/api-client'
import { VALID_BUSINESS_TYPES } from '@/lib/file-business-types'

type DashboardRange = 7 | 30 | 90
type TrendKey = 'users' | 'projects' | 'articles' | 'notes'

type DashboardData = {
  range: { days: DashboardRange; start: string; end: string; generatedAt: string }
  overview: {
    users: { total: number; activeSessions: number; totalPoints: number }
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

const TREND_CLASS: Record<TrendKey, string> = {
  users: 'is-users',
  projects: 'is-projects',
  articles: 'is-content',
  notes: 'is-notes',
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
  noSeriesLabel,
}: {
  trend: DashboardData['trend']
  labels: Record<TrendKey, string>
  locale: string
  ariaLabel: string
  emptyLabel: string
  noSeriesLabel: string
}) {
  const [visible, setVisible] = useState<Record<TrendKey, boolean>>({
    users: true,
    projects: true,
    articles: true,
    notes: true,
  })
  const chartRef = useRef<SVGSVGElement>(null)
  const [viewport, setViewport] = useState({ width: 760, height: 248, fontSize: 11 })

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width <= 0) return
      const { width, height } = entry.contentRect
      const fontSize = Number.parseFloat(getComputedStyle(chart).fontSize)
      setViewport((current) => current.width === width && current.height === height && current.fontSize === fontSize
        ? current
        : { width, height, fontSize })
    })
    observer.observe(chart)
    return () => observer.disconnect()
  }, [])

  const { width, height, fontSize } = viewport
  const visibleKeys = TREND_KEYS.filter((key) => visible[key])
  const peak = Math.max(1, ...trend.flatMap((point) => visibleKeys.map((key) => point[key])))
  const tickCount = Math.min(4, peak)
  const tickStep = Math.ceil(peak / tickCount)
  const maximum = tickStep * tickCount
  const left = Math.max(28, String(maximum).length * fontSize * 0.65 + 12)
  const right = fontSize * 2
  const top = fontSize * 1.5
  const bottom = fontSize * 3
  const chartWidth = Math.max(1, width - left - right)
  const chartHeight = Math.max(1, height - top - bottom)
  const hasData = trend.some((point) => visibleKeys.some((key) => point[key] > 0))
  const x = (index: number) => left + (trend.length <= 1 ? chartWidth / 2 : (index / (trend.length - 1)) * chartWidth)
  const y = (value: number) => top + chartHeight - (value / maximum) * chartHeight
  const polyline = (key: TrendKey) => trend.map((point, index) => `${x(index)},${y(point[key])}`).join(' ')
  const labelCount = Math.max(2, Math.min(6, trend.length, Math.floor(chartWidth / (fontSize * 6))))
  const labelIndices = new Set(Array.from({ length: labelCount }, (_, index) => Math.round(index * (trend.length - 1) / (labelCount - 1))))

  return (
    <div className="dashboard-trend-chart">
      <div className="dashboard-trend-legend" aria-label={ariaLabel}>
        {TREND_KEYS.map((key) => (
          <button
            aria-pressed={visible[key]}
            className={`dashboard-trend-toggle ${TREND_CLASS[key]} ${visible[key] ? '' : 'is-muted'}`}
            key={key}
            onClick={() => setVisible((current) => ({ ...current, [key]: !current[key] }))}
            type="button"
          >
            <span className="dashboard-trend-swatch" aria-hidden="true" />
            {labels[key]}
            <strong>{formatAdminNumber(locale, trend.reduce((total, point) => total + point[key], 0))}</strong>
          </button>
        ))}
      </div>
      <div className="dashboard-chart-stage">
        <svg ref={chartRef} aria-label={ariaLabel} role="img">
          {Array.from({ length: tickCount + 1 }, (_, index) => index * tickStep).map((value) => {
            const position = y(value)
            return (
              <g key={value}>
                <line className="dashboard-chart-grid" x1={left} x2={width - right} y1={position} y2={position} />
                <text className="dashboard-chart-axis" x={left - 7} y={position + 3} textAnchor="end">{formatAdminNumber(locale, value)}</text>
              </g>
            )
          })}
          {trend.map((point, index) => (
            labelIndices.has(index) ? (
              <text className="dashboard-chart-axis" key={point.date} x={x(index)} y={height - 10} textAnchor="middle">
                {new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${point.date}T00:00:00.000Z`))}
              </text>
            ) : null
          ))}
          {visibleKeys.map((key) => (
            <polyline className={`dashboard-chart-line ${TREND_CLASS[key]}`} fill="none" key={key} points={polyline(key)} />
          ))}
          {visibleKeys.flatMap((key) => trend.map((point, index) => point[key] > 0 ? (
            <circle className={`dashboard-chart-dot ${TREND_CLASS[key]}`} cx={x(index)} cy={y(point[key])} key={`${key}-${point.date}`} r="3">
              <title>{`${labels[key]} · ${point.date}: ${point[key]}`}</title>
            </circle>
          ) : null))}
        </svg>
        {!hasData ? <div className="dashboard-chart-empty"><ChartNoAxesCombined size={20} /><span>{visibleKeys.length ? emptyLabel : noSeriesLabel}</span></div> : null}
      </div>
    </div>
  )
}

export function DashboardView() {
  const t = useTranslations('AdminMM.dashboard')
  const fileT = useTranslations('AdminMM.files.businessType')
  const locale = useLocale()
  const [range, setRange] = useState<DashboardRange>(30)
  const query = useQuery({
    queryKey: ['admin-dashboard', range],
    queryFn: () => apiFetch<DashboardData>(`/api/admin/mm/dashboard?range=${range}`),
    placeholderData: keepPreviousData,
  })
  const data = query.data

  const trendLabels = useMemo<Record<TrendKey, string>>(() => ({
    users: t('trend.users'),
    projects: t('trend.projects'),
    articles: t('trend.articles'),
    notes: t('trend.notes'),
  }), [t])

  if (query.isError && !data) {
    return (
      <AdminPage className="admin-dashboard-page">
        <DashboardToolbar range={range} setRange={setRange} loading={query.isFetching} onRefresh={() => void query.refetch()} t={t} />
        <Alert
          type="error"
          showIcon
          title={t('messages.loadFailed')}
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
        <section className="dashboard-overview" aria-busy="true">
          <div className="dashboard-metric-grid">{Array.from({ length: 4 }, (_, index) => <div className="dashboard-metric-card" key={index}><Skeleton active paragraph={{ rows: 2 }} title={false} /></div>)}</div>
          <div className="dashboard-supporting-metrics">{Array.from({ length: 4 }, (_, index) => <div className="dashboard-supporting-metric" key={index}><Skeleton active paragraph={{ rows: 1 }} title={false} /></div>)}</div>
        </section>
        <div className="dashboard-loading-panels"><Skeleton active paragraph={{ rows: 8 }} /><Skeleton active paragraph={{ rows: 8 }} /></div>
      </AdminPage>
    )
  }

  const { overview, periodTotals } = data
  const evidence = overview.blockchain.evidence
  const metrics: Array<{
    key: string
    icon: LucideIcon
    title: string
    value: string
    meta: string
    href: string
  }> = [
    { key: 'users', icon: Users, title: t('stats.users'), value: formatAdminNumber(locale, overview.users.total), meta: t('metrics.users', { count: formatAdminNumber(locale, periodTotals.users), days: data.range.days }), href: '/admin/mm/users' },
    { key: 'sessions', icon: ShieldCheck, title: t('stats.activeSessions'), value: formatAdminNumber(locale, overview.users.activeSessions), meta: t('metrics.sessions'), href: '/admin/mm/users' },
    { key: 'projects', icon: Boxes, title: t('stats.projects'), value: formatAdminNumber(locale, overview.projects.total), meta: t('metrics.projects', { active: formatAdminNumber(locale, overview.projects.active), versions: formatAdminNumber(locale, overview.versions.total), count: formatAdminNumber(locale, periodTotals.projects) }), href: '/admin/mm/projects' },
    { key: 'content', icon: Newspaper, title: t('stats.articles'), value: formatAdminNumber(locale, overview.articles.total), meta: t('metrics.content', { published: formatAdminNumber(locale, overview.articles.published), notes: formatAdminNumber(locale, overview.notes.total), count: formatAdminNumber(locale, periodTotals.articles) }), href: '/admin/mm/articles' },
    { key: 'categories', icon: FolderTree, title: t('stats.categories'), value: formatAdminNumber(locale, overview.categories.total), meta: t('metrics.categories', { active: formatAdminNumber(locale, overview.categories.active), notes: formatAdminNumber(locale, overview.notes.active) }), href: '/admin/mm/notes' },
    { key: 'points', icon: Coins, title: t('stats.points'), value: formatAdminNumber(locale, overview.users.totalPoints), meta: t('metrics.corePoints'), href: '/admin/mm/users' },
    { key: 'files', icon: FileStack, title: t('stats.files'), value: formatAdminBytes(locale, overview.files.totalSizeBytes), meta: t('metrics.files', { count: formatAdminNumber(locale, overview.files.total) }), href: '/admin/mm/files' },
    { key: 'evidence', icon: ArchiveRestore, title: t('stats.evidence'), value: formatAdminNumber(locale, evidence.total), meta: t('metrics.evidence', { finalized: formatAdminNumber(locale, evidence.finalized), pending: formatAdminNumber(locale, evidence.pending) }), href: '/admin/mm/evidence' },
  ]
  const primaryKeys = ['users', 'projects', 'content', 'files']
  const healthEntries = [
    { key: 'projectUtilization', active: overview.projects.active, total: overview.projects.total },
    { key: 'articlePublicationRate', active: overview.articles.published, total: overview.articles.total },
    { key: 'noteUtilization', active: overview.notes.active, total: overview.notes.total },
    { key: 'categoryUtilization', active: overview.categories.active, total: overview.categories.total },
    { key: 'evidenceFinalizationRate', active: evidence.finalized, total: evidence.total },
  ] as const
  const fileTypes = [...overview.files.byType].sort((left, right) => right.count - left.count).slice(0, 5)
  const fileMaximum = Math.max(1, ...fileTypes.map((item) => item.count))
  const attention = [
    evidence.failed > 0 ? { key: 'failed', icon: CircleAlert, tone: 'danger', title: t('attention.failedTitle', { count: formatAdminNumber(locale, evidence.failed) }), description: t('attention.failedDescription'), href: '/admin/mm/evidence' } : null,
    evidence.pending > 0 ? { key: 'pending', icon: Clock3, tone: 'warning', title: t('attention.pendingTitle', { count: formatAdminNumber(locale, evidence.pending) }), description: t('attention.pendingDescription'), href: '/admin/mm/evidence' } : null,
  ].filter(Boolean) as Array<{ key: string; icon: LucideIcon; tone: string; title: string; description: string; href: string }>

  return (
    <AdminPage className="admin-dashboard-page" aria-busy={query.isFetching}>
      <DashboardToolbar range={range} setRange={setRange} loading={query.isFetching} onRefresh={() => void query.refetch()} t={t} generatedAt={formatAdminDate(locale, data.range.generatedAt)} />

      {query.isError ? <Alert type="warning" showIcon title={t('messages.loadFailed')} description={t('messages.stale')} action={<Button onClick={() => void query.refetch()}>{t('actions.refresh')}</Button>} /> : null}

      <section className="dashboard-overview" aria-label={t('metrics.title')}>
        <div className="dashboard-metric-grid">
          {metrics.filter((metric) => primaryKeys.includes(metric.key)).map((metric) => {
            const Icon = metric.icon
            return (
              <Link className="dashboard-metric-card" href={metric.href} key={metric.key}>
                <span className="dashboard-metric-label"><Icon size={15} aria-hidden="true" />{metric.title}<ArrowUpRight className="dashboard-metric-arrow" size={14} aria-hidden="true" /></span>
                <strong className="dashboard-metric-value">{metric.value}</strong>
                <span className="dashboard-metric-meta">{metric.meta}</span>
              </Link>
            )
          })}
        </div>
        <div className="dashboard-supporting-metrics">
          {metrics.filter((metric) => !primaryKeys.includes(metric.key)).map((metric) => {
            const Icon = metric.icon
            return <Link className="dashboard-supporting-metric" href={metric.href} key={metric.key}><span><Icon size={14} aria-hidden="true" />{metric.title}</span><strong>{metric.value}</strong><small>{metric.meta}</small></Link>
          })}
        </div>
      </section>

      <PluginSlot name="admin.dashboard.cards" surface="admin" />

      {attention.length ? <section className="dashboard-attention-list" aria-label={t('attention.title')}>
        {attention.map((item) => {
          const Icon = item.icon
          return <Link className={`dashboard-attention-item is-${item.tone}`} href={item.href} key={item.key}><Icon size={18} aria-hidden="true" /><span><strong>{item.title}</strong><small>{item.description}</small></span><ArrowRight size={15} aria-hidden="true" /></Link>
        })}
      </section> : null}

      <section className="dashboard-primary-grid">
        <Card className="dashboard-panel dashboard-trend-panel" title={<PanelTitle icon={ChartNoAxesCombined} title={t('trend.title')} description={t('trend.description', { days: data.range.days })} />}>
          <DashboardTrendChart ariaLabel={t('trend.accessible')} emptyLabel={t('trend.empty')} noSeriesLabel={t('trend.selectSeries')} labels={trendLabels} locale={locale} trend={data.trend} />
        </Card>
        <Card className="dashboard-panel dashboard-health-panel" title={<PanelTitle icon={BookOpenText} title={t('health.title')} description={t('health.description')} />}>
          <div className="dashboard-health-list">
            {healthEntries.map(({ key, active, total }) => (
              <div className="dashboard-health-row" key={key}>
                <div><span>{t(`health.${key}`)}</span><small>{formatAdminNumber(locale, active)} / {formatAdminNumber(locale, total)}</small><strong>{total ? `${formatAdminNumber(locale, data.health[key])}%` : '—'}</strong></div>
                <Progress percent={data.health[key]} showInfo={false} strokeColor="var(--sv-dashboard-health)" />
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="dashboard-secondary-grid">
        <Card className="dashboard-panel dashboard-activity-panel" title={<PanelTitle icon={Clock3} title={t('recent.title')} description={t('recent.description')} />}>
          {data.recentActivity.feed.length ? (
            <div className="dashboard-activity-list">
              {data.recentActivity.feed.map((item) => {
                const Icon = ACTIVITY_ICON[item.type]
                return (
                  <Link className="dashboard-activity-item" href={item.href} key={item.id}>
                    <span className={`dashboard-activity-icon is-${item.type}`}><Icon size={17} aria-hidden="true" /></span>
                    <span className="dashboard-activity-copy"><strong>{item.title}</strong><small>{item.detail || t(`recent.types.${item.type}`)}</small></span>
                    {item.status ? <Tag className="dashboard-activity-status" color={item.status === 'active' ? 'success' : item.status === 'expired' ? 'warning' : 'error'}>{t(`recent.status.${item.status}`)}</Tag> : null}
                    <time dateTime={item.timestamp}>{formatAdminDate(locale, item.timestamp)}</time>
                    <ArrowUpRight className="dashboard-activity-arrow" size={14} aria-hidden="true" />
                  </Link>
                )
              })}
            </div>
          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('messages.noData')} />}
        </Card>
        <div className="dashboard-side-stack">
          <Card className="dashboard-panel" title={<PanelTitle icon={FolderUp} title={t('files.typeDistribution')} description={t('files.description', { count: formatAdminNumber(locale, overview.files.total) })} />}>
            {fileTypes.length ? <div className="dashboard-distribution-list">
              {fileTypes.map((item) => {
                const businessType = VALID_BUSINESS_TYPES.find((type) => type === item.type)
                return <div className="dashboard-distribution-row" key={item.type}>
                  <div><span>{businessType ? fileT(businessType) : item.type}</span><strong>{formatAdminNumber(locale, item.count)}</strong></div>
                  <span className="dashboard-distribution-track"><span style={{ width: `${(item.count / fileMaximum) * 100}%` }} /></span>
                  <small>{formatAdminBytes(locale, item.sizeBytes)}</small>
                </div>
              })}
            </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('messages.noData')} />}
          </Card>
          <Card className="dashboard-panel" title={<PanelTitle icon={BadgeCheck} title={t('evidence.title')} description={t('evidence.description')} />}>
            <div className="dashboard-evidence-summary">
              {[
                { key: 'finalized', value: evidence.finalized, tone: 'success' },
                { key: 'pending', value: evidence.pending, tone: 'warning' },
                { key: 'failed', value: evidence.failed, tone: 'danger' },
              ].map((item) => <Link className={`dashboard-evidence-status is-${item.tone}`} href="/admin/mm/evidence" key={item.key}><span>{t(`evidence.${item.key}`)}</span><strong>{formatAdminNumber(locale, item.value)}</strong></Link>)}
            </div>
            {!attention.length ? <div className="dashboard-all-clear"><ShieldCheck size={16} aria-hidden="true" /><span><strong>{t('attention.clearTitle')}</strong><small>{t('attention.clearDescription')}</small></span></div> : null}
            <Link className="dashboard-panel-link" href="/admin/mm/evidence">{t('actions.openEvidence')} <ArrowRight size={14} aria-hidden="true" /></Link>
          </Card>
        </div>
      </section>
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
        <h1>{t('title')}</h1>
        <div className="dashboard-toolbar-meta"><p>{t('desc')}</p>{generatedAt ? <span className="dashboard-generated-at">{t('generatedAt', { date: generatedAt })}</span> : null}</div>
      </div>
      <div className="dashboard-toolbar-actions">
        <Segmented<DashboardRange> aria-label={t('rangeLabel')} disabled={loading} onChange={setRange} options={[7, 30, 90].map((value) => ({ label: t('range', { days: value }), value: value as DashboardRange }))} value={range} />
        <Button icon={<RefreshCw size={15} />} loading={loading} onClick={onRefresh}>{t('actions.refresh')}</Button>
      </div>
    </header>
  )
}

function PanelTitle({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return <div className="dashboard-panel-title"><Icon size={17} aria-hidden="true" /><div><h2>{title}</h2><small>{description}</small></div></div>
}
