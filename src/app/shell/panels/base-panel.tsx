import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
// AI-REMOVED 2026-08-19:
// Reason: BasePanel 不再手工同步 App 层的多基地模式副本，因此无需 runInAction。
// Trigger: SimulationMode 单一事实源改造。
// Evidence: checkbox 直接读取 SimulationState.simulationMode，写入统一经过 SimulationAction。
// Replacement: None
// Risk: Low
// Human Review: Required
//
// Original code:
// import { runInAction } from "mobx";
// AI-CORRECTION 2026-08-19: runInAction 仍用于 effect 更新 siblingBaseCount；只移除了模式副本同步用途。
import { runInAction } from "mobx";
import { observer } from "mobx-react-lite";
import { createPortal } from "react-dom";

import { useEditorDocumentSnapshot } from "@/app/shell/hooks/use-editor-document";
import {
  fetchHelpMarkdownHtml,
  MarkdownTutorialOverlay,
} from "@/app/shell/dialogs";
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
// AI-REMOVED 2026-08-19:
// Reason: checkbox 改为读取 RegionalSettingsController，不再直接比较 SimulationMode。
// Trigger: 用户要求多基地选择持久化、同步，实验开关仅控制当前是否生效。
// Evidence: main.tsx 组合根根据持久选择派生有效 SimulationMode。
// Replacement: AppHost.regionalSettings.multiBaseEnabled。
// Risk: Low
// Human Review: Required
//
// Original code:
// import { SIMULATION_MODE } from "@/domain/shared/simulation-mode";
import { isCustomPortPriorityGroupsEnabled } from "@/shared/port-priority-groups";
import { resolveBaseMaxPipeLogistics } from "@/shared/base-tags";
import { regionalSimulationUiState } from "@/app/state/regional-simulation-ui-state";
import { createPublicAssetUrl } from "@/shared/browser/public-asset-url";
import {
  collectBaseConfigurationProblems,
  collectRuntimeInfiniteStorageEntityIds,
} from "@/app/shell/panels/base-configuration-problems";
import styles from "@/app/shell/app-shell.module.scss";
import { cm } from "@/app/shell/shared/css-module-class";
import panelStyles from "@/app/shell/panels/panels.module.scss";
import { RegionalResourcesCard } from "@/app/shell/panels/regional-resources-card";

const BASE_PANEL_POWER_INTERVAL_MS = 250;
const BASE_PANEL_PROBLEM_INTERVAL_MS = 250;
const REGIONAL_MULTI_BASE_HELP_PATH = createPublicAssetUrl(
  "help/config-guide/experimental-regional-multi-base.md",
);

function areStringSetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

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

export const BasePanel = observer(function BasePanel({ appHost }: { appHost: AppHost }) {
  const t = appHost.actions.translate;
  const editor = appHost.workspace.editor;
  const currentDocument = useEditorDocumentSnapshot(editor);
  const currentBaseId = currentDocument?.baseId ?? DEFAULT_WORLD_BASE_ID;
  const currentBase = appHost.workspace.registry.baseDefinitions.find(
    (definition) => definition.id === currentBaseId,
  ) ?? appHost.workspace.registry.baseDefinitions[0] ?? null;
  const currentBaseName = currentBase?.name ?? currentBaseId;
  const [regionalHelpTutorialVisible, setRegionalHelpTutorialVisible] = useState(false);
  useEffect(() => {
    const siblings = appHost.workspace.registry.baseDefinitions.filter((definition) =>
      definition.tag === currentBase?.tag,
    ).length - 1;
    runInAction(() => {
      regionalSimulationUiState.siblingBaseCount = Math.max(0, siblings);
    });
  }, [appHost.workspace.registry.baseDefinitions, currentBase?.tag]);
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

  const [runtimeInfiniteStorageEntityIds, setRuntimeInfiniteStorageEntityIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  useEffect(() => {
    const tick = () => {
      const simulation = appHost.workspace.simulation;
      if (currentDocument === null || simulation === null) {
        setRuntimeInfiniteStorageEntityIds((current) =>
          current.size === 0 ? current : new Set(),
        );
        return;
      }

      const entities = Object.values(currentDocument.entities);
      const runtimeSlotItemsByEntityId = new Map(
        entities.flatMap((entity) => {
          const runtimeStatus = simulation.queries.getDeviceRuntimeStatus(entity.id);
          return runtimeStatus === null
            ? []
            : [[entity.id, runtimeStatus.slotItems] as const];
        }),
      );
      const next = collectRuntimeInfiniteStorageEntityIds({
        entities,
        entityDefinitions: appHost.workspace.registry.entityDefinitions,
        runtimeSlotItemsByEntityId,
      });
      setRuntimeInfiniteStorageEntityIds((current) =>
        areStringSetsEqual(current, next) ? current : next,
      );
    };

    tick();
    const intervalId = window.setInterval(tick, BASE_PANEL_PROBLEM_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [appHost, appHost.workspace.registry.entityDefinitions, currentDocument]);

  // AI-REMOVED 2026-08-19:
  // Reason: 多基地 checkbox 不再从 SimulationMode 读取，组件级 simulation 局部变量失去用途。
  // Trigger: 多基地选择迁移到可持久化、可同步的 RegionalSettingsController。
  // Evidence: 事件处理器在其局部作用域内仍会按需读取 simulation 以关闭时间轴。
  // Replacement: appHost.regionalSettings.multiBaseEnabled。
  // Risk: Low
  // Human Review: Required
  //
  // Original code:
  // const simulation = appHost.workspace.simulation;
  const multiBaseEnabled = appHost.regionalSettings.multiBaseEnabled;

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

    // ④ 作弊设备、无效无限资源与普通槽位无限配置
    problems.push(...collectBaseConfigurationProblems({
      entities,
      entityDefinitions: appHost.workspace.registry.entityDefinitions,
      itemDefinitions: appHost.workspace.registry.itemDefinitions,
      slotLinks: currentDocument.slotLinks,
      multiBaseEnabled,
      runtimeInfiniteStorageEntityIds,
    }));

    return problems;
  }, [
    appHost.workspace.registry.entityDefinitions,
    appHost.workspace.registry.itemDefinitions,
    currentDocument,
    currentBase,
    deviceStats.pipeLogisticsDevices,
    editor,
    multiBaseEnabled,
    resolveDeviceName,
    runtimeInfiniteStorageEntityIds,
  ]);

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
        {regionalSimulationUiState.experimentalEnabled && (
          <div className={cm(styles, "base-regional-switch")}>
            <label className={cm(styles, "base-regional-switch-control")}>
              <input
                checked={multiBaseEnabled}
                disabled={
                  regionalSimulationUiState.siblingBaseCount < 1
                  || appHost.workspace.simulation?.state.runningState !== "stop"
                }
                onChange={(event) => {
                  const simulation = appHost.workspace.simulation;
                  if (simulation === null) return;

                  const enabled = event.target.checked;
                  if (
                    enabled
                    && (
                      appHost.internalState.workbench.dialogState.timeline.visible
                      || simulation.state.timeline.enabled
                    )
                  ) {
                    simulation.actions.disableTimeline();
                  }

                  // AI-REMOVED 2026-08-19:
                  // Reason: 多基地选择属于可同步的地区设置资产，SimulationMode 仅保存实验开关过滤后的当前有效模式。
                  // Trigger: 用户要求“同时运行所有基地”具备记忆并跨设备同步，同时关闭实验开关不得丢失选择。
                  // Evidence: RegionalSettingsController.multiBaseEnabled 已是持久化与同步的唯一事实来源。
                  // Replacement: appHost.regionalSettings.setMultiBaseEnabled(enabled)。
                  // Risk: Low
                  // Human Review: Required
                  //
                  // Original code:
                  // simulation.actions.setRegionalMultiBaseEnabled(enabled);
                  appHost.regionalSettings.setMultiBaseEnabled(enabled);
                  // AI-REMOVED 2026-08-19:
                  // Reason: checkbox 状态直接观察 SimulationState.simulationMode，不再同步 App 副本。
                  // Trigger: SimulationMode 单一事实源改造。
                  // Evidence: Action 会在非 stop 状态拒绝切换，直接读取 state 可避免 UI 错误显示已切换。
                  // Replacement: simulation.actions.setRegionalMultiBaseEnabled(enabled)。
                  // Risk: Low
                  // Human Review: Required
                  //
                  // Original code:
                  // runInAction(() => {
                  //   regionalSimulationUiState.allBasesEnabled = enabled;
                  // });
                  // AI-CORRECTION 2026-08-19: 当前 checkbox 读取 RegionalSettingsController，SimulationMode 由 main.tsx 的实验门控 reaction 派生。
                  if (enabled) {
                    setRegionalHelpTutorialVisible(true);
                  }
                }}
                type="checkbox"
              />
              <span className={cm(styles, "base-regional-switch-label")}>
                {t("basePanel.runAllBases")}
              </span>
            </label>
            <RegionalMultiBaseHelp
              compactLayout={appHost.state.screenProfile.deviceClass === "mobile"}
              onCloseTutorial={() => setRegionalHelpTutorialVisible(false)}
              t={t}
              tutorialVisible={regionalHelpTutorialVisible}
            />
          </div>
        )}
      </article>
      <RegionalResourcesCard
        appHost={appHost}
        regionTag={currentBase?.tag ?? currentBaseName}
      />
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
});

function RegionalMultiBaseHelp({
  compactLayout,
  onCloseTutorial,
  t,
  tutorialVisible,
}: {
  compactLayout: boolean;
  onCloseTutorial: () => void;
  t: AppHost["actions"]["translate"];
  tutorialVisible: boolean;
}) {
  const tooltipId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipHtml, setTooltipHtml] = useState<string | null>(null);
  const [tooltipLoadFailed, setTooltipLoadFailed] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const title = t("basePanel.runAllBasesHelp");

  useEffect(() => {
    if (!tooltipVisible || tooltipHtml !== null || tooltipLoadFailed) return;

    let cancelled = false;
    void fetchHelpMarkdownHtml(REGIONAL_MULTI_BASE_HELP_PATH, {
      stripLeadingH1: true,
    }).then((html) => {
      if (!cancelled) {
        setTooltipHtml(html);
      }
    }).catch(() => {
      if (!cancelled) {
        setTooltipLoadFailed(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [tooltipHtml, tooltipLoadFailed, tooltipVisible]);

  useEffect(() => {
    if (!tooltipVisible) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target === null
        || buttonRef.current?.contains(target)
        || tooltipRef.current?.contains(target)
      ) {
        return;
      }
      setTooltipVisible(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setTooltipVisible(false);
      }
    };
    const handleViewportChange = () => {
      setTooltipVisible(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [tooltipVisible]);

  const handleToggleTooltip = () => {
    if (tooltipVisible) {
      setTooltipVisible(false);
      return;
    }

    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect === undefined) return;

    const horizontalPadding = 8;
    const popoverWidth = Math.min(360, window.innerWidth - horizontalPadding * 2);
    const left = Math.max(
      horizontalPadding,
      Math.min(
        rect.right - popoverWidth,
        window.innerWidth - popoverWidth - horizontalPadding,
      ),
    );
    const gap = 8;
    const spaceAbove = Math.max(0, rect.top - gap - horizontalPadding);
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - horizontalPadding);
    setTooltipPosition(spaceBelow >= spaceAbove
      ? { left, maxHeight: spaceBelow, top: rect.bottom + gap }
      : { left, maxHeight: spaceAbove, bottom: window.innerHeight - rect.top + gap });
    setTooltipVisible(true);
  };

  return (
    <>
      <button
        aria-controls={tooltipVisible ? tooltipId : undefined}
        aria-expanded={tooltipVisible}
        aria-label={title}
        className={cm(panelStyles, "base-regional-help-button")}
        onClick={handleToggleTooltip}
        ref={buttonRef}
        title={title}
        type="button"
      >
        <WorkbenchIcon kind="help" />
      </button>
      {tooltipVisible && tooltipPosition !== null
        ? createPortal(
          <div
            className={cm(panelStyles, "base-regional-help-tooltip")}
            id={tooltipId}
            ref={tooltipRef}
            role="tooltip"
            style={{
              position: "fixed",
              ...tooltipPosition,
            }}
          >
            {tooltipLoadFailed ? (
              <p>{t("basePanel.runAllBasesHelpLoadFailed")}</p>
            ) : tooltipHtml === null ? (
              <p>{t("basePanel.runAllBasesHelpLoading")}</p>
            ) : (
              <div
                className={cm(panelStyles, "base-regional-help-markdown")}
                dangerouslySetInnerHTML={{ __html: tooltipHtml }}
              />
            )}
          </div>,
          document.body,
        )
        : null}
      <MarkdownTutorialOverlay
        compactLayout={compactLayout}
        dialogKey="regional-multi-base-guide"
        onClose={onCloseTutorial}
        path={REGIONAL_MULTI_BASE_HELP_PATH}
        title={title}
        visible={tutorialVisible}
      />
    </>
  );
}
