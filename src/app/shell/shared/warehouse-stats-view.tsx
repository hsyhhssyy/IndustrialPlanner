import { useCallback, useEffect, useState } from "react";

import type { AppHost } from "@/app/host/app-host";
import type { WarehouseStatsReadModel } from "@/domain/simulation";
import type { ItemDefinition } from "@/domain/registry/types/item-definition";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import LucidePin from "~icons/lucide/pin";
import LucidePinOff from "~icons/lucide/pin-off";

const WAREHOUSE_STATS_INTERVAL_MS = 250;
const WAREHOUSE_PINNED_ITEMS_KEY = "industrial-planner.warehouse-pinned-items";
const WAREHOUSE_PINNED_ITEMS_EVENT = "warehouse-pinned-items-changed";
const MAX_PINNED_ITEMS = 10;

type WarehouseStatsEntry = {
  readonly itemId: string;
  readonly item: ItemDefinition | null;
  readonly label: string;
  readonly iconSrc: string;
  readonly producedPerMinute: number;
  readonly consumedPerMinute: number;
  readonly warehouseCount: number;
  readonly lastChangedTick: number;
  readonly pinned: boolean;
};

type WarehouseStatsViewMode = "compact" | "dialog";

export function useWarehouseStats(appHost: AppHost) {
  const [stats, setStats] = useState<WarehouseStatsReadModel | null>(() => (
    appHost.workspace.simulation?.queries.getWarehouseStats() ?? null
  ));

  useEffect(() => {
    const tick = () => {
      setStats(appHost.workspace.simulation?.queries.getWarehouseStats() ?? null);
    };

    tick();
    const intervalId = window.setInterval(tick, WAREHOUSE_STATS_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [appHost]);

  return stats;
}

export function useWarehousePinnedItems(appHost: AppHost) {
  const [pinnedItemIds, setPinnedItemIds] = useState<readonly string[]>(() => loadPinnedItemIds(appHost));

  useEffect(() => {
    const syncPinnedItems = () => {
      setPinnedItemIds(loadPinnedItemIds(appHost));
    };

    window.addEventListener(WAREHOUSE_PINNED_ITEMS_EVENT, syncPinnedItems);
    window.addEventListener("storage", syncPinnedItems);

    return () => {
      window.removeEventListener(WAREHOUSE_PINNED_ITEMS_EVENT, syncPinnedItems);
      window.removeEventListener("storage", syncPinnedItems);
    };
  }, [appHost]);

  const togglePinned = useCallback((itemId: string) => {
    setPinnedItemIds((current) => {
      const exists = current.includes(itemId);
      const next = exists
        ? current.filter((candidate) => candidate !== itemId)
        : current.length >= MAX_PINNED_ITEMS
          ? current
          : [...current, itemId];
      savePinnedItemIds(next);
      window.setTimeout(() => {
        window.dispatchEvent(new Event(WAREHOUSE_PINNED_ITEMS_EVENT));
      }, 0);
      return next;
    });
  }, []);

  return { pinnedItemIds, togglePinned, maxPinnedItems: MAX_PINNED_ITEMS };
}

export function buildWarehouseStatsEntries(options: {
  readonly appHost: AppHost;
  readonly stats: WarehouseStatsReadModel | null;
  readonly pinnedItemIds: readonly string[];
}): readonly WarehouseStatsEntry[] {
  if (options.stats === null) {
    return [];
  }

  const t = options.appHost.actions.translate;
  const itemById = new Map(options.appHost.workspace.registry.itemDefinitions.map((item) => [item.id, item]));
  const pinnedSet = new Set(options.pinnedItemIds);

  return Object.entries(options.stats.items)
    .map(([itemId, stats]) => {
      const item = itemById.get(itemId) ?? null;
      return {
        itemId,
        item,
        label: item === null ? itemId : t(item.nameKey),
        iconSrc: `/item-icons/${item?.iconId ?? itemId}.webp`,
        producedPerMinute: stats.producedPerMinute,
        consumedPerMinute: stats.consumedPerMinute,
        warehouseCount: stats.warehouseCount,
        lastChangedTick: stats.lastChangedTick,
        pinned: pinnedSet.has(itemId),
      };
    })
    .sort(compareWarehouseStatsEntry);
}

export function WarehouseStatsView({
  appHost,
  entries,
  mode,
  pinnedItemIds,
  query = "",
  onTogglePinned,
}: {
  readonly appHost: AppHost;
  readonly entries: readonly WarehouseStatsEntry[];
  readonly mode: WarehouseStatsViewMode;
  readonly pinnedItemIds: readonly string[];
  readonly query?: string;
  readonly onTogglePinned: (itemId: string) => void;
}) {
  const t = appHost.actions.translate;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const pinnedSet = new Set(pinnedItemIds);
  const filteredEntries = normalizedQuery.length === 0
    ? entries
    : entries.filter((entry) => (
      entry.label.toLocaleLowerCase().includes(normalizedQuery)
      || entry.itemId.toLocaleLowerCase().includes(normalizedQuery)
    ));

  if (filteredEntries.length === 0) {
    const emptyKey = normalizedQuery.length === 0 ? "warehouseStats.empty" : "warehouseStats.noResults";
    return (
      <div className={cm(styles, mode === "compact" ? "warehouse-stats-empty" : "warehouse-stats-dialog-empty")}>
        {t(emptyKey)}
      </div>
    );
  }

  return (
    <div className={cm(styles, mode === "compact" ? "warehouse-stats-table" : "warehouse-stats-table warehouse-stats-table-dialog")}>
      <div className={cm(styles, "warehouse-stats-row warehouse-stats-row-head")}> 
        <span>{t("warehouseStats.item")}</span>
        <span>{t("warehouseStats.produced")}</span>
        <span>{t("warehouseStats.consumed")}</span>
        <span>{t("warehouseStats.stock")}</span>
        {mode === "dialog" ? <span>{t("warehouseStats.pin")}</span> : null}
      </div>
      {filteredEntries.map((entry) => {
        const canPin = entry.pinned || pinnedSet.size < MAX_PINNED_ITEMS;
        return (
          <div className={cm(styles, entry.pinned ? "warehouse-stats-row is-pinned" : "warehouse-stats-row")} key={entry.itemId}>
            <span className={cm(styles, "warehouse-stats-item-cell")} title={entry.label}>
              <img alt="" aria-hidden="true" draggable={false} src={entry.iconSrc} />
              <span>{entry.label}</span>
            </span>
            <span className={cm(styles, "warehouse-stats-number")}>{formatStatsNumber(entry.producedPerMinute)}</span>
            <span className={cm(styles, "warehouse-stats-number")}>{formatStatsNumber(entry.consumedPerMinute)}</span>
            <span className={cm(styles, "warehouse-stats-number")}>{formatStatsNumber(entry.warehouseCount)}</span>
            {mode === "dialog" ? (
              <button
                aria-pressed={entry.pinned}
                className={cm(styles, entry.pinned ? "warehouse-stats-pin-button is-active" : "warehouse-stats-pin-button")}
                disabled={!canPin}
                onClick={() => onTogglePinned(entry.itemId)}
                title={entry.pinned ? t("warehouseStats.unpin") : t("warehouseStats.pin")}
                type="button"
              >
                {entry.pinned ? <LucidePinOff /> : <LucidePin />}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function resolveCompactWarehouseEntries(entries: readonly WarehouseStatsEntry[]): readonly WarehouseStatsEntry[] {
  const pinned = entries.filter((entry) => entry.pinned);
  const recent = entries
    .filter((entry) => !entry.pinned)
    .sort((left, right) => right.lastChangedTick - left.lastChangedTick || compareWarehouseStatsEntry(left, right))
    .slice(0, Math.max(0, 10 - pinned.length));
  return [...pinned, ...recent];
}

export function formatStatsNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "∞";
  }
  if (Math.abs(value) < 0.005) {
    return "0";
  }
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function compareWarehouseStatsEntry(left: WarehouseStatsEntry, right: WarehouseStatsEntry): number {
  if (left.pinned !== right.pinned) {
    return left.pinned ? -1 : 1;
  }

  const leftOrder = left.item?.displayOrder ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.item?.displayOrder ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return left.itemId.localeCompare(right.itemId);
}

function loadPinnedItemIds(appHost: AppHost): readonly string[] {
  try {
    const raw = window.localStorage.getItem(WAREHOUSE_PINNED_ITEMS_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const validItemIds = new Set(appHost.workspace.registry.itemDefinitions.map((item) => item.id));
    return parsed
      .filter((value): value is string => typeof value === "string" && validItemIds.has(value))
      .slice(0, MAX_PINNED_ITEMS);
  } catch {
    return [];
  }
}

function savePinnedItemIds(itemIds: readonly string[]): void {
  try {
    window.localStorage.setItem(WAREHOUSE_PINNED_ITEMS_KEY, JSON.stringify(itemIds.slice(0, MAX_PINNED_ITEMS)));
  } catch {
    // localStorage may be unavailable in private contexts.
  }
}
