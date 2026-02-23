import { useEffect, useMemo, useRef, useState } from 'react'
import { ITEMS } from '../../domain/registry'
import type { ItemId, SimState } from '../../domain/types'
import { getItemLabel, type Language } from '../../i18n'

type UseObservabilityDomainParams = {
  sim: SimState
  measuredTickRate: number
  ignoredInfiniteItemIds: ReadonlySet<ItemId>
  language: Language
  t: (key: string, params?: Record<string, string | number>) => string
  formatCompactNumber: (value: number) => string
  formatCompactStock: (value: number) => string
  statsTopN: number
}

export function useObservabilityDomain({
  sim,
  measuredTickRate,
  ignoredInfiniteItemIds,
  language,
  t,
  formatCompactNumber,
  formatCompactStock,
  statsTopN,
}: UseObservabilityDomainParams) {
  const [showAllStatsRows, setShowAllStatsRows] = useState(false)
  const [statsTableMaxHeight, setStatsTableMaxHeight] = useState<number | null>(null)
  const statsTableRef = useRef<HTMLTableElement | null>(null)

  const statsRows = useMemo(() => {
    const rows = ITEMS.map((item) => ({
      itemId: item.id,
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

    const hasPriorityStock = (row: (typeof rows)[number]) => {
      if (Number.isFinite(row.stock)) return row.stock > 0
      return row.consumedPerMinute > 0
    }

    rows.sort((a, b) => {
      const priorityDiff = Number(hasPriorityStock(b)) - Number(hasPriorityStock(a))
      if (priorityDiff !== 0) return priorityDiff

      const producedDiff = b.producedPerMinute - a.producedPerMinute
      if (producedDiff !== 0) return producedDiff

      return a.itemId.localeCompare(b.itemId)
    })

    return rows
  }, [ignoredInfiniteItemIds, sim.stats.consumedPerMinute, sim.stats.producedPerMinute, sim.warehouse, sim.stats.everConsumed, sim.stats.everProduced, sim.stats.everStockPositive])

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
                <td>{formatCompactNumber(row.producedPerMinute)}</td>
                <td>{formatCompactNumber(row.consumedPerMinute)}</td>
                <td>{formatCompactStock(row.stock)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>{t('right.simDebug')}</h3>
      <div className="kv"><span>{t('debug.measuredTps')}</span><span>{measuredTickRate.toFixed(2)}</span></div>
      <div className="kv"><span>{t('debug.simTick')}</span><span>{sim.tick}</span></div>
      <div className="kv"><span>{t('debug.simSeconds')}</span><span>{sim.stats.simSeconds.toFixed(2)}</span></div>
    </>
  )

  return {
    statsAndDebugSection,
  }
}
