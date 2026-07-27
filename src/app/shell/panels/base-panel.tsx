import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
import { EntityCollectionType } from "@/domain/editor/types/editor-types";
import { isCustomPortPriorityGroupsEnabled } from "@/shared/port-priority-groups";
import { resolveBaseMaxPipeLogistics } from "@/shared/base-tags";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import panelStyles from "@/app/shell/panels/panels.module.scss";

const BASE_PANEL_POWER_INTERVAL_MS = 250;

// AI-REMOVED 2026-07-27:
// Reason: app 不应维护 4 个管道物流设备 definition ID。
// Trigger: 用户要求 registry 外只使用 Query，并明确管道物流设备不包括管道节。
// Evidence: RegistryQuery.isPipeLogistics 精确覆盖分流器、汇流器、桥接器和准入口。
// Replacement: BasePanel.deviceStats 中的 registry.queries.isPipeLogistics。
// Risk: Low
// Human Review: Required
//
// Original code:
// const PIPE_ATTACHMENT_IDS = new Set([
//   "pipe_splitter", "pipe_converger", "pipe_connector", "pipe_admission",
// ]);

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

  const deviceStats = useMemo(() => {
    if (currentDocument === null) {
      return { totalDevices: 0, pipeLogisticsDevices: 0 };
    }
    const entities = Object.values(currentDocument.entities);
    const totalDevices = entities.length;
    // 管道物流设备仅包含四种物流角色，明确不包括管道节。
    const pipeLogisticsDevices = entities.filter((e) =>
      appHost.workspace.registry.queries.isPipeLogistics(e.definitionId),
    ).length;
    return { totalDevices, pipeLogisticsDevices };
  }, [appHost.workspace.registry.queries, currentDocument]);

  // -------------------------------------------------------------------------
  // 基地问题收集
  // -------------------------------------------------------------------------

  interface BaseProblem {
    readonly message: string;
    readonly severity: "error" | "warning";
    readonly tooltip: string;
    /** 关联的设备 ID，用于点击聚焦 */
    readonly entityId?: string;
  }

  /** 根据 definitionId 解析设备中文名 */
  const resolveDeviceName = useCallback(
    (definitionId: string): string => {
      const definition = appHost.workspace.registry.entityDefinitions.find(
        (d) => d.id === definitionId,
      );
      if (definition === undefined) return definitionId;
      const translated = t(definition.nameKey);
      return translated === definition.nameKey ? definitionId : translated;
    },
    [appHost.workspace.registry.entityDefinitions, t],
  );

  const baseProblems = useMemo<BaseProblem[]>(() => {
    const problems: BaseProblem[] = [];
    if (currentDocument === null || editor === null) return problems;

    const entities = Object.values(currentDocument.entities);
    const invalidIds = editor.state.collections[EntityCollectionType.invalidPlacement];

    // ① 无效放置
    for (const entityId of invalidIds) {
      const entity = entities.find((e) => e.id === entityId);
      if (entity === undefined) continue;
      const deviceName = resolveDeviceName(entity.definitionId);
      const msg = `设备「${deviceName}」放置无效`;
      problems.push({ message: msg, severity: "error", tooltip: msg, entityId: entity.id });
    }

    // ② 管道物流数超限
    // AI-CORRECTION 2026-07-27: 此处统计管道物流设备，不包括管道节。
    const maxPipe = currentBase !== null
      ? resolveBaseMaxPipeLogistics(currentBase.tags)
      : null;
    if (maxPipe !== null && deviceStats.pipeLogisticsDevices > maxPipe) {
      const msg = `管道物流设备数 (${deviceStats.pipeLogisticsDevices}) 超过基地上限 (${maxPipe})`;
      problems.push({ message: msg, severity: "error", tooltip: msg });
    }

    // ③ 端口优先级组
    for (const entity of entities) {
      if (isCustomPortPriorityGroupsEnabled(entity.config)) {
        const deviceName = resolveDeviceName(entity.definitionId);
        const msg = `设备「${deviceName}」配置了端口优先级组`;
        problems.push({ message: msg, severity: "warning", tooltip: msg });
      }
    }

    return problems;
  }, [currentDocument, editor, currentBase, deviceStats.pipeLogisticsDevices, resolveDeviceName]);

  const [activeProblemTooltip, setActiveProblemTooltip] = useState<number | null>(null);
  const [popoverRect, setPopoverRect] = useState<{ top: number; left: number } | null>(null);
  const problemRowRefs = useRef<Map<number, HTMLElement>>(new Map());

  // 点击外部关闭 popover
  const handleDocumentPointerDown = useCallback((e: PointerEvent) => {
    const target = e.target as Node | null;
    if (target === null) return;
    // 点击在触发按钮所在行上 → 不关闭
    if (activeProblemTooltip !== null) {
      const rowEl = problemRowRefs.current.get(activeProblemTooltip);
      if (rowEl?.contains(target)) return;
    }
    setActiveProblemTooltip(null);
    setPopoverRect(null);
  }, [activeProblemTooltip]);

  useEffect(() => {
    if (activeProblemTooltip === null) return;
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    return () => document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
  }, [activeProblemTooltip, handleDocumentPointerDown]);

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
      <article className={cm(styles, "inspector-card")}>
        <div className={cm(styles, "card-header")}>
          <h3>问题</h3>
        </div>
        <div className={cm(panelStyles, "base-problem-list")} role="list">
          {baseProblems.length > 0 ? (
            baseProblems.map((problem, index) => (
              <div
                className={cm(panelStyles, "base-problem-row")}
                data-problem-severity={problem.severity}
                key={index}
                ref={(el) => {
                  if (el !== null) {
                    problemRowRefs.current.set(index, el);
                  } else {
                    problemRowRefs.current.delete(index);
                  }
                }}
                role="listitem"
              >
                <button
                  className={cm(panelStyles, "base-problem-button")}
                  onClick={(e) => {
                    e.stopPropagation();
                    const problem = baseProblems[index];
                    if (problem === undefined) return;
                    // 若关联了设备，聚焦到该设备
                    if (problem.entityId !== undefined && editor !== null) {
                      editor.actions.focusOnEntity(problem.entityId);
                    }
                    if (activeProblemTooltip === index) {
                      setActiveProblemTooltip(null);
                      setPopoverRect(null);
                    } else {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setPopoverRect({
                        top: rect.top,
                        left: rect.right + 6,
                      });
                      setActiveProblemTooltip(index);
                    }
                  }}
                  type="button"
                >
                  {problem.message}
                </button>
              </div>
            ))
          ) : (
            <div className={cm(panelStyles, "base-problem-empty")}>无</div>
          )}
        </div>
        {activeProblemTooltip !== null && popoverRect !== null
          ? createPortal(
            <div
              className={cm(panelStyles, "base-problem-popover")}
              style={{
                position: "fixed",
                top: `${popoverRect.top}px`,
                left: `${popoverRect.left}px`,
              }}
            >
              <div className={cm(panelStyles, "base-problem-popover-text")}>
                {baseProblems[activeProblemTooltip]?.tooltip}
              </div>
            </div>,
            document.body,
          )
          : null}
      </article>
    </div>
  );
}
