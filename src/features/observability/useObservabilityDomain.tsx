import { useEffect, useMemo, useRef, useState } from 'react'
import { ITEMS } from '../../domain/registry'
import type { ItemId, PowerMode, SimState } from '../../domain/types'
import { getItemLabel, type Language } from '../../i18n'

type UseObservabilityDomainParams = {
  sim: SimState
  measuredTickRate: number
  measuredFrameRate: number
  smoothedFrameRate: number
  minFrameRate: number
  maxFrameRate: number
  longFrame50Count: number
  longFrame100Count: number
  maxFrameTimeMs: number
  avgFrameTimeMs: number
  avgTicksPerFrame: number
  maxTicksPerFrameSeen: number
  avgTickWorkMs: number
  maxTickWorkMs: number
  avgUiCommitGapMs: number
  maxUiCommitGapMs: number
  ignoredInfiniteItemIds: ReadonlySet<ItemId>
  powerMode: PowerMode
  language: Language
  t: (key: string, params?: Record<string, string | number>) => string
  formatCompactNumber: (value: number) => string
  formatCompactStock: (value: number) => string
  statsTopN: number
}

export function useObservabilityDomain({
  sim,
  measuredTickRate,
  measuredFrameRate,
  smoothedFrameRate,
  minFrameRate,
  maxFrameRate,
  longFrame50Count,
  longFrame100Count,
  maxFrameTimeMs,
  avgFrameTimeMs,
  avgTicksPerFrame,
  maxTicksPerFrameSeen,
  avgTickWorkMs,
  maxTickWorkMs,
  avgUiCommitGapMs,
  maxUiCommitGapMs,
  ignoredInfiniteItemIds,
  powerMode,
  language,
  t,
  formatCompactNumber,
  formatCompactStock,
  statsTopN,
}: UseObservabilityDomainParams) {
  const [showAllStatsRows, setShowAllStatsRows] = useState(false)
  const [showDebugDetails, setShowDebugDetails] = useState(false)
  const [statsTableMaxHeight, setStatsTableMaxHeight] = useState<number | null>(null)
  const statsTableRef = useRef<HTMLTableElement | null>(null)

  const formatRateValue = (value: number) => {
    if (!Number.isFinite(value)) return '0'
    return `${Math.max(0, Math.round(value))}`
  }

  const formatBatteryStored = (valueJ: number) => {
    if (!Number.isFinite(valueJ) || valueJ <= 0) return '0J'

    const formatUnit = (value: number, unit: 'MJ' | 'KJ') => {
      const rounded = Math.round(value * 10) / 10
      return `${rounded.toFixed(1)}${unit}`
    }

    if (valueJ >= 1_000_000) return formatUnit(valueJ / 1_000_000, 'MJ')
    if (valueJ >= 1_000) return formatUnit(valueJ / 1_000, 'KJ')
    return `${Math.round(valueJ)}J`
  }

  const statsRows = useMemo(() => {
    const rows = ITEMS.map((item) => ({
      itemId: item.id,
      itemLabel: getItemLabel(language, item.id),
      producedPerMinute: sim.stats.producedPerMinute[item.id],
      consumedPerMinute: sim.stats.consumedPerMinute[item.id],
      stock: ignoredInfiniteItemIds.has(item.id) ? Number.POSITIVE_INFINITY : sim.warehouse[item.id],
      everProduced: sim.stats.everProduced[item.id] ?? 0,
      everConsumed: sim.stats.everConsumed[item.id] ?? 0,
      everStockPositive: sim.stats.everStockPositive[item.id] ?? 0,
    })).filter((row) => {
      const hasProduced = row.everProduced > 0
      const hasConsumed = row.everConsumed > 0
      const hasStock = row.everStockPositive > 0
      if (!Number.isFinite(row.stock)) {
        return hasProduced || hasConsumed || ignoredInfiniteItemIds.has(row.itemId)
      }
      return hasProduced || hasConsumed || hasStock
    })

    rows.sort((a, b) => {
      const labelDiff = a.itemLabel.localeCompare(b.itemLabel, language)
      if (labelDiff !== 0) return labelDiff
      return a.itemId.localeCompare(b.itemId)
    })

    return rows
  }, [ignoredInfiniteItemIds, language, sim.stats.consumedPerMinute, sim.stats.producedPerMinute, sim.warehouse, sim.stats.everConsumed, sim.stats.everProduced, sim.stats.everStockPositive])

  const hasMoreStatsRows = statsRows.length > statsTopN
  const visibleStatsRows = hasMoreStatsRows && !showAllStatsRows ? statsRows.slice(0, statsTopN) : statsRows

  useEffect(() => {
    const measureStatsTableHeight = () => {
      const table = statsTableRef.current
      if (!table) {
        setStatsTableMaxHeight(null)
        return
      }

      const bodyRows = Array.from(table.tBodies[0]?.rows ?? [])
      if (bodyRows.length <= statsTopN) {
        setStatsTableMaxHeight(null)
        return
      }

      const headerHeight = table.tHead?.rows[0]?.getBoundingClientRect().height ?? 0
      const firstRowsHeight = bodyRows.slice(0, statsTopN).reduce((sum, row) => sum + row.getBoundingClientRect().height, 0)

      setStatsTableMaxHeight(Math.ceil(headerHeight + firstRowsHeight + 2))
    }

    const frameId = window.requestAnimationFrame(measureStatsTableHeight)
    window.addEventListener('resize', measureStatsTableHeight)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', measureStatsTableHeight)
    }
  }, [language, showAllStatsRows, statsTopN, visibleStatsRows.length])

  const renderStatsBreakHeader = (label: string) => {
    if (language !== 'zh-CN' || label.length <= 2) return label
    return (
      <>
        <span>{label.slice(0, 2)}</span>
        <br />
        <span>{label.slice(2)}</span>
      </>
    )
  }

  const statsAndDebugSection = (
    <>
      <div className="kv">
        <span>
          {`${t('right.powerDemand')}/${t('right.powerSupply')} ${formatCompactNumber(sim.powerStats.totalDemandKw)}/${powerMode === 'infinite' ? t('right.infinity') : formatCompactNumber(sim.powerStats.totalSupplyKw)} kW`}
        </span>
        <span>{sim.powerMode === 'infinite' ? `${t('right.infinity')}/100.0%` : `${formatBatteryStored(sim.powerStats.batteryStoredJ)}/${sim.powerStats.batteryPercent.toFixed(1)}%`}</span>
      </div>

      <h3>{t('right.stats')}</h3>
      <div className="stats-meta-row">
        <span className="stats-meta-text">{t('stats.topNHint', { count: visibleStatsRows.length, total: statsRows.length })}</span>
        {hasMoreStatsRows && (
          <button className="stats-toggle-btn" onClick={() => setShowAllStatsRows((current) => !current)}>
            {showAllStatsRows ? t('stats.showTop', { count: statsTopN }) : t('stats.showAll')}
          </button>
        )}
      </div>
      <div className="stats-table-wrap" style={statsTableMaxHeight ? { maxHeight: `${statsTableMaxHeight}px` } : undefined}>
        <table ref={statsTableRef} className="stats-table">
          <thead>
            <tr>
              <th className="stats-break-header">{renderStatsBreakHeader(t('table.itemName'))}</th>
              <th className="stats-break-header">{renderStatsBreakHeader(t('table.producedPerMinute'))}</th>
              <th className="stats-break-header">{renderStatsBreakHeader(t('table.consumedPerMinute'))}</th>
              <th className="stats-break-header">{renderStatsBreakHeader(t('table.currentStock'))}</th>
            </tr>
          </thead>
          <tbody>
            {visibleStatsRows.map((row) => (
              <tr key={row.itemId}>
                <td>{getItemLabel(language, row.itemId)}</td>
                <td>{formatRateValue(row.producedPerMinute)}</td>
                <td>{formatRateValue(row.consumedPerMinute)}</td>
                <td>{formatCompactStock(row.stock)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>{t('right.simDebug')}</h3>
      <div className="kv"><span>{t('debug.smoothedFps')}</span><span>{smoothedFrameRate.toFixed(2)}</span></div>
      <div className="kv"><span>{t('debug.simSeconds')}</span><span>{sim.stats.simSeconds.toFixed(2)}</span></div>
      <div className="kv"><span>{t('debug.avgTicksPerFrame')}</span><span>{avgTicksPerFrame.toFixed(2)}</span></div>
      <button className="stats-toggle-btn" onClick={() => setShowDebugDetails((current) => !current)}>
        {showDebugDetails ? t('debug.detailsCollapse') : t('debug.detailsExpand')}
      </button>
      {showDebugDetails && (
        <>
          <div className="kv"><span>{t('debug.measuredTps')}</span><span>{measuredTickRate.toFixed(2)}</span></div>
          <div className="kv"><span>{t('debug.measuredFps')}</span><span>{measuredFrameRate.toFixed(2)}</span></div>
          <div className="kv"><span>{t('debug.fpsMinMax')}</span><span>{`${minFrameRate.toFixed(2)} / ${maxFrameRate.toFixed(2)}`}</span></div>
          <div className="kv"><span>{t('debug.frameTimeAvgMaxMs')}</span><span>{`${avgFrameTimeMs.toFixed(2)} / ${maxFrameTimeMs.toFixed(2)}`}</span></div>
          <div className="kv"><span>{t('debug.longFrames50_100')}</span><span>{`${longFrame50Count} / ${longFrame100Count}`}</span></div>
          <div className="kv"><span>{t('debug.ticksPerFrameAvgMax')}</span><span>{`${avgTicksPerFrame.toFixed(2)} / ${maxTicksPerFrameSeen}`}</span></div>
          <div className="kv"><span>{t('debug.tickWorkMsAvgMax')}</span><span>{`${avgTickWorkMs.toFixed(2)} / ${maxTickWorkMs.toFixed(2)}`}</span></div>
          <div className="kv"><span>{t('debug.uiCommitGapMsAvgMax')}</span><span>{`${avgUiCommitGapMs.toFixed(2)} / ${maxUiCommitGapMs.toFixed(2)}`}</span></div>
          <div className="kv"><span>{t('debug.simTick')}</span><span>{sim.tick}</span></div>
        </>
      )}
    </>
  )

  return {
    statsAndDebugSection,
  }
}
