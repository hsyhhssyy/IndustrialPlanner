import { useEffect, useMemo, useState } from "react";

import { useEditorDocumentSnapshot } from "@/app/shell/hooks/use-editor-document";
import { WorkbenchIcon } from "@/app/shell/shared/workbench-icons";
import { NumberInput } from "@/app/shell/shared/number-input";
import LucideTrash2 from "~icons/lucide/trash-2";
import type { AppHost } from "@/app/host/app-host";
import { DEFAULT_WORLD_BASE_ID } from "@/domain/document/world-document";
import {
  buildWarehouseStatsEntries,
  resolveCompactWarehouseEntries,
  useWarehousePinnedItems,
  useWarehouseStats,
  WarehouseStatsView,
} from "@/app/shell/shared/warehouse-stats-view";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import panelStyles from "@/app/shell/panels/panels.module.scss";

const BASE_PANEL_POWER_INTERVAL_MS = 250;

export function BasePanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const editor = appHost.workspace.editor;
  const currentDocument = useEditorDocumentSnapshot(editor);
  const currentBaseId = currentDocument?.baseId ?? DEFAULT_WORLD_BASE_ID;
  const currentBase = appHost.workspace.registry.baseDefinitions.find(
    (definition) => definition.id === currentBaseId,
  ) ?? appHost.workspace.registry.baseDefinitions[0] ?? null;
  const currentBaseName = currentBase?.name ?? currentBaseId;
  const warehouseStats = useWarehouseStats(appHost);
  const pinnedItems = useWarehousePinnedItems(appHost);
  const warehouseEntries = buildWarehouseStatsEntries({
    appHost,
    stats: warehouseStats,
    pinnedItemIds: pinnedItems.pinnedItemIds,
  });
  const compactWarehouseEntries = resolveCompactWarehouseEntries(warehouseEntries);

  // 设备统计
  const PIPE_ATTACHMENT_IDS = new Set([
    "pipe_splitter",
    "pipe_converger",
    "pipe_connector",
    "pipe_admission",
  ]);

  const deviceStats = useMemo(() => {
    if (currentDocument === null) {
      return { totalDevices: 0, pipeLogisticsDevices: 0 };
    }
    const entities = Object.values(currentDocument.entities);
    const totalDevices = entities.length;
    const pipeLogisticsDevices = entities.filter((e) =>
      PIPE_ATTACHMENT_IDS.has(e.definitionId),
    ).length;
    return { totalDevices, pipeLogisticsDevices };
  }, [currentDocument]);

  // 主动轮询仿真文档级运行时数据（非 MobX 被动响应）
  const [totalPowerDemand, setTotalPowerDemand] = useState<number | null>(null);
  const [currentPowerGeneration, setCurrentPowerGeneration] = useState<number | null>(null);
  const [isPowerOutage, setIsPowerOutage] = useState<boolean>(false);
  const [baseBatteryJoules, setBaseBatteryJoules] = useState<number | null>(null);
  const [baseBatteryCapacity, setBaseBatteryCapacity] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const docStatus = appHost.workspace.simulation?.queries.getDocumentRuntimeStatus() ?? null;
      setTotalPowerDemand(docStatus?.totalPowerDemand ?? null);
      setCurrentPowerGeneration(docStatus?.currentPowerGeneration ?? null);
      setIsPowerOutage(docStatus?.isPowerOutage ?? false);
      const stats = appHost.workspace.simulation?.state.statistics;
      setBaseBatteryJoules(stats?.baseBatteryJoules ?? null);
      setBaseBatteryCapacity(stats?.baseBatteryCapacity ?? null);
    };

    tick();
    const intervalId = window.setInterval(tick, BASE_PANEL_POWER_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [appHost]);

  const powerMode: "real" | "infinite" =
    currentDocument?.documentSettings?.powerMode === "real" ? "real" : "infinite";

  const handleTogglePowerMode = () => {
    if (editor === null) return;
    const nextMode: "real" | "infinite" = powerMode === "real" ? "infinite" : "real";
    // 写入 documentSettings（silent）→ simulation 自动监听到并同步到 worker
    editor.actions.writeDocumentSettings({ powerMode: nextMode });
  };

  // 手动覆盖总耗电
  const powerConsumptionOverride: number | undefined = (() => {
    const raw = currentDocument?.documentSettings?.powerConsumptionOverride;
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : undefined;
  })();
  const hasOverride = powerConsumptionOverride !== undefined;

  const handleOverrideCommit = (value: number) => {
    if (editor === null) return;
    editor.actions.writeDocumentSettings({ powerConsumptionOverride: Math.max(0, value) });
  };

  const handleClearOverride = () => {
    if (editor === null) return;
    editor.actions.writeDocumentSettings({ powerConsumptionOverride: undefined });
  };

  // 电力横条数据
  const demandDisplay = totalPowerDemand !== null ? `${totalPowerDemand} kW` : "-- kW";
  const isInfinite = powerMode === "infinite";
  const generationDisplay = isInfinite
    ? "∞"
    : currentPowerGeneration !== null
      ? `${currentPowerGeneration} kW`
      : "-- kW";

  // 电池剩余百分比
  let percentageText = "--%";
  if (baseBatteryJoules !== null && baseBatteryCapacity !== null && baseBatteryCapacity > 0) {
    const rawPct = (baseBatteryJoules / baseBatteryCapacity) * 100;
    // 99.5~99.9 强制显示 99%，防止四舍五入虚标 100%
    // AI-CORRECTION 2026-06-12: 阈值从 >=99.5→99 调整为 >=99.995→99.99，显示从整数改为2位小数
    const pct = (rawPct >= 99.995 && rawPct < 100) ? 99.99 : Math.min(100, rawPct);
    percentageText = `${pct.toFixed(2)}%`;
  }

  // 停电时文字变红
  const powerRowClassName = isPowerOutage && !isInfinite
    ? cm(styles, "power-bar-label", "power-bar-outage")
    : cm(styles, "power-bar-label");

  return (
    <div className={cm(styles, "stack")}>
      <article className={cm(styles, "inspector-card")}>
        <div className={cm(styles, "card-header")}>
          <h3>{t("rightDock.base")}</h3>
        </div>
        <button
          className={cm(styles, "base-current-button")}
          data-ui-button-id="base-current-select"
          disabled={editor === null}
          onClick={() => {
            appHost.internalActions.openDialog("base-select");
          }}
          type="button"
        >
          <span className={cm(styles, "base-current-button-label")}>{currentBaseName}</span>
          <span className={cm(styles, "base-current-button-icon")}>
            <WorkbenchIcon kind="edit" />
          </span>
        </button>
      </article>
      <article className={cm(styles, "inspector-card")}>
        <div className={cm(styles, "card-header")}>
          <h3>{t("rightDock.power")}</h3>
        </div>
        <div className={cm(styles, "power-bar-shell")}>
          <div className={powerRowClassName}>
            <span className={cm(styles, "power-bar-values")}>
              {demandDisplay}
              <span className={cm(styles, "power-bar-separator")}>/</span>
              {generationDisplay}
            </span>
            <span className={cm(styles, "power-bar-percent")}>{percentageText}</span>
          </div>
        </div>
        <label className={cm(styles, "power-infinite-switch")}>
          <span className={cm(styles, "power-infinite-switch-label")}>
            {t("workbench.power.infiniteSwitch")}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={isInfinite}
            className={cm(styles, isInfinite ? "power-switch-on" : "power-switch-off")}
            onClick={handleTogglePowerMode}
          >
            <span className={cm(styles, "power-switch-thumb")} />
          </button>
        </label>
        {!isInfinite ? (
          <div className={cm(panelStyles, "power-override-row")}>
            <label className={cm(panelStyles, "power-override-label")}>
              {t("workbench.power.covered")}
            </label>
            <div className={cm(panelStyles, "power-override-controls")}>
              <NumberInput
                className={cm(panelStyles, "power-override-input")}
                min={0}
                placeholder={t("workbench.powerValue.covered")}
                value={hasOverride ? powerConsumptionOverride : ""}
                onCommit={handleOverrideCommit}
              />
              {hasOverride ? (
                <button
                  aria-label={t("workbench.power.clearOverride")}
                  className={cm(panelStyles, "power-override-clear")}
                  type="button"
                  onClick={handleClearOverride}
                >
                  <LucideTrash2 aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </article>
      <article className={cm(styles, "inspector-card")}> 
        <div className={cm(styles, "card-header warehouse-stats-card-header")}> 
          <h3>{t("warehouseStats.title")}</h3>
          <button
            className={cm(styles, "warehouse-stats-more-button")}
            disabled={warehouseStats === null}
            onClick={() => appHost.internalActions.openDialog("warehouse-stats")}
            type="button"
          >
            {t("warehouseStats.more")}
          </button>
        </div>
        {warehouseStats === null ? (
          <div className={cm(styles, "warehouse-stats-placeholder")}>{t("warehouseStats.runToView")}</div>
        ) : (
          <WarehouseStatsView
            appHost={appHost}
            entries={compactWarehouseEntries}
            mode="compact"
            onTogglePinned={pinnedItems.togglePinned}
            pinnedItemIds={pinnedItems.pinnedItemIds}
          />
        )}
      </article>
      <article className={cm(styles, "inspector-card")}>
        <div className={cm(styles, "card-header")}>
          <h3>{t("deviceStats.title")}</h3>
        </div>
        <div className={cm(styles, "device-stats-row")}>
          <span>{t("deviceStats.totalDevices")}</span>
          <span>{deviceStats.totalDevices}</span>
        </div>
        <div className={cm(styles, "device-stats-row")}>
          <span>{t("deviceStats.pipeLogisticsDevices")}</span>
          <span>{deviceStats.pipeLogisticsDevices}</span>
        </div>
      </article>
    </div>
  );
}
