'use client'

/**
 * @file account-points-chart.tsx
 * @project SlothVault
 * @module Account Dashboard Charts
 * @description Renders accessible SVG balance and point-flow charts with the account's current design tokens.
 * @logic Register only the required ECharts modules, draw recorded balances or signed transaction totals, resize with the container, update colors on theme changes, and dispose on unmount.
 * @dependencies React, ECharts, account-dashboard point summary, SlothVault design tokens
 * @index_tags account,dashboard,echarts,svg,points,theme,responsive,accessibility
 * @author holic512
 */

import { useEffect, useRef } from 'react'

import { LineChart, PieChart } from 'echarts/charts'
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { init, use as registerCharts, type EChartsCoreOption } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'

import type { AccountPointsSummary } from '@/lib/account-dashboard'

registerCharts([LineChart, PieChart, AriaComponent, GridComponent, LegendComponent, TooltipComponent, SVGRenderer])

export default function AccountPointsChart({
  kind, summary, locale, ariaLabel, balanceLabel, incomeLabel, spendingLabel,
}: {
  kind: 'balance' | 'flow'
  summary: AccountPointsSummary
  locale: string
  ariaLabel: string
  balanceLabel: string
  incomeLabel: string
  spendingLabel: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = init(container, undefined, { renderer: 'svg' })
    const numbers = new Intl.NumberFormat(locale)
    const dates = new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' })
    const draw = () => {
      const style = getComputedStyle(container)
      const primary = style.getPropertyValue('--sv-primary').trim()
      const muted = style.getPropertyValue('--sv-text-muted').trim()
      const border = style.getPropertyValue('--sv-border').trim()
      const option: EChartsCoreOption = {
        animation: false,
        color: [primary, muted],
        textStyle: { fontFamily: style.fontFamily, color: muted },
        aria: { enabled: true, label: { description: ariaLabel } },
        tooltip: { trigger: kind === 'balance' ? 'axis' : 'item', confine: true, renderMode: 'richText' },
        ...(kind === 'balance' ? {
          grid: { left: 12, right: 16, top: 12, bottom: 12, outerBoundsMode: 'same' },
          xAxis: {
            type: 'time',
            axisLine: { lineStyle: { color: border } },
            axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: { color: muted, hideOverlap: true, formatter: (value: number) => dates.format(value) },
          },
          yAxis: {
            type: 'value',
            min: (value: { min: number }) => Math.min(0, value.min),
            minInterval: 1,
            axisLabel: { color: muted, formatter: (value: number) => numbers.format(value) },
            splitLine: { lineStyle: { color: border, type: 'dashed' } },
          },
          series: [{
            name: balanceLabel,
            type: 'line',
            step: 'end',
            data: summary.balances,
            symbol: 'circle',
            symbolSize: 6,
            showSymbol: summary.balances.length <= 12,
            lineStyle: { width: 2, color: primary },
            itemStyle: { color: primary },
            areaStyle: { color: primary, opacity: 0.06 },
          }],
        } : {
          legend: { bottom: 0, icon: 'circle', itemWidth: 9, itemHeight: 9, textStyle: { color: muted } },
          series: [{
            type: 'pie',
            radius: ['52%', '72%'],
            center: ['50%', '44%'],
            label: { show: false },
            emphasis: { scale: false },
            data: [
              { name: incomeLabel, value: summary.income },
              { name: spendingLabel, value: summary.spending },
            ].filter((item) => item.value > 0),
          }],
        }),
      }
      chart.setOption(option, { notMerge: true })
    }

    draw()
    const resizeObserver = new ResizeObserver(() => chart.resize())
    resizeObserver.observe(container)
    const themeObserver = new MutationObserver(draw)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-style'] })

    return () => {
      resizeObserver.disconnect()
      themeObserver.disconnect()
      chart.dispose()
    }
  }, [kind, summary, locale, ariaLabel, balanceLabel, incomeLabel, spendingLabel])

  return <div ref={containerRef} className="account-dashboard-chart" role="img" aria-label={ariaLabel} />
}
